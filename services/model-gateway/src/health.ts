import type { ProviderId } from "@orbaagent/shared";
import { MODEL_CATALOG, type ModelDefinition } from "./catalog.js";

export type ModelHealthStatus =
  | "AVAILABLE"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "TEMPORARILY_FAILED"
  | "UNAVAILABLE"
  | "DISABLED"
  | "UNKNOWN";

export interface ModelHealthRecord {
  modelId: string;
  provider: ProviderId;
  displayName: string;
  status: ModelHealthStatus;
  failureCount: number;
  lastFailureTime?: number;
  cooldownUntil?: number;
  lastSuccessTime?: number;
  lastErrorType?: string;
  latency?: number;
  rateLimitResetAt?: number;
}

export class ModelHealthTracker {
  private readonly records: Map<string, ModelHealthRecord> = new Map();
  private readonly defaultCooldownMs: number;

  constructor(defaultCooldownMs = 60000) {
    this.defaultCooldownMs = defaultCooldownMs;
    this.initializeFromCatalog();
  }

  private initializeFromCatalog(): void {
    for (const [id, def] of Object.entries(MODEL_CATALOG)) {
      this.records.set(id, {
        modelId: id,
        provider: def.provider,
        displayName: def.displayName,
        status: def.enabled ? "AVAILABLE" : "DISABLED",
        failureCount: 0,
      });
    }
  }

  public getRecord(modelId: string): ModelHealthRecord {
    let rec = this.records.get(modelId);
    if (!rec) {
      const def = MODEL_CATALOG[modelId];
      rec = {
        modelId,
        provider: def?.provider || (modelId.startsWith("openrouter") ? "openrouter" : "langdock"),
        displayName: def?.displayName || modelId,
        // A model that is not in the catalog has never been confirmed to exist and
        // must not be considered routable. Catalog entries keep their own status.
        status: def ? (def.enabled ? "AVAILABLE" : "DISABLED") : "UNKNOWN",
        failureCount: 0,
      };
      this.records.set(modelId, rec);
    }

    // Evaluate cooldown expiration automatically
    if (
      (rec.status === "RATE_LIMITED" ||
        rec.status === "TEMPORARILY_FAILED" ||
        rec.status === "UNAVAILABLE") &&
      rec.cooldownUntil &&
      Date.now() >= rec.cooldownUntil
    ) {
      rec.status = "AVAILABLE";
      rec.failureCount = 0;
      rec.cooldownUntil = undefined;
      rec.rateLimitResetAt = undefined;
    }

    return rec;
  }

  public isModelEligible(modelId: string): boolean {
    const rec = this.getRecord(modelId);
    return rec.status === "AVAILABLE";
  }

  public recordModelSuccess(modelId: string, latencyMs?: number): void {
    const rec = this.getRecord(modelId);
    rec.status = "AVAILABLE";
    rec.failureCount = 0;
    rec.cooldownUntil = undefined;
    rec.lastSuccessTime = Date.now();
    rec.latency = latencyMs;
    rec.lastErrorType = undefined;
  }

  public recordModelFailure(
    modelId: string,
    errorType: "RATE_LIMITED" | "TEMPORARILY_FAILED" | "AUTH_FAILED" | "UNAVAILABLE",
    retryAfterMs?: number,
    errorMessage?: string,
  ): void {
    const rec = this.getRecord(modelId);
    rec.failureCount += 1;
    rec.lastFailureTime = Date.now();
    rec.lastErrorType = errorMessage || errorType;

    if (errorType === "RATE_LIMITED") {
      rec.status = "RATE_LIMITED";
      // Use retry-after or bounded exponential backoff (min 15s, max 120s)
      const backoff = retryAfterMs || Math.min(15000 * 2 ** (rec.failureCount - 1), 120000);
      rec.cooldownUntil = Date.now() + backoff;
      rec.rateLimitResetAt = rec.cooldownUntil;
    } else if (errorType === "TEMPORARILY_FAILED") {
      rec.status = "TEMPORARILY_FAILED";
      const backoff = retryAfterMs || this.defaultCooldownMs;
      rec.cooldownUntil = Date.now() + backoff;
    } else if (errorType === "AUTH_FAILED") {
      rec.status = "AUTH_FAILED";
      rec.cooldownUntil = Date.now() + this.defaultCooldownMs;
    } else {
      rec.status = "UNAVAILABLE";
      rec.cooldownUntil = Date.now() + this.defaultCooldownMs;
    }
  }

  public clearProviderFailures(provider: ProviderId): void {
    for (const rec of this.records.values()) {
      if (rec.provider === provider) {
        rec.status = "AVAILABLE";
        rec.failureCount = 0;
        rec.cooldownUntil = undefined;
        rec.lastErrorType = undefined;
      }
    }
  }

  public getAllRecords(): ModelHealthRecord[] {
    const list: ModelHealthRecord[] = [];
    for (const id of Object.keys(MODEL_CATALOG)) {
      list.push(this.getRecord(id));
    }
    return list;
  }

  public resetAll(): void {
    this.records.clear();
    this.initializeFromCatalog();
  }
}

/**
 * Returns provider configuration/authentication status and eligible model counts without exposing secrets.
 * Performs lightweight auth checks against provider /models endpoint where available.
 */
export async function getProvidersAuthStatus(): Promise<{
  langdockConfigured: boolean;
  openrouterConfigured: boolean;
  langdockAuth: "PASS" | "FAIL" | "UNKNOWN";
  openrouterAuth: "PASS" | "FAIL" | "UNKNOWN";
  eligibleLangdockModels: number;
  eligibleOpenRouterModels: number;
}> {
  const langdockKey = process.env.LANGDOCK_API_KEY || process.env.Langdock_API_KEY || "";
  const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API || "";
  const langdockConfigured = Boolean(langdockKey && langdockKey !== "undefined");
  const openrouterConfigured = Boolean(openrouterKey && openrouterKey !== "undefined");

  const eligibleLangdockModels = Object.values(MODEL_CATALOG).filter(
    (m) => m.enabled && m.provider === "langdock",
  ).length;
  const eligibleOpenRouterModels = Object.values(MODEL_CATALOG).filter(
    (m) => m.enabled && m.provider === "openrouter",
  ).length;

  async function check(baseUrl: string, key: string): Promise<"PASS" | "FAIL" | "UNKNOWN"> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 200) return "PASS";
      if (res.status === 401 || res.status === 403) return "FAIL";
      return "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }

  const langdockBase =
    process.env.LANGDOCK_BASE_URL ||
    process.env.LANGDOCK_ENDPOINT_URL ||
    "https://api.langdock.com/openai/eu/v1";
  const openrouterBase = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  const [langdockAuth, openrouterAuth] = await Promise.all([
    langdockConfigured ? check(langdockBase, langdockKey) : Promise.resolve("UNKNOWN" as const),
    openrouterConfigured
      ? check(openrouterBase, openrouterKey)
      : Promise.resolve("UNKNOWN" as const),
  ]);

  return {
    langdockConfigured,
    openrouterConfigured,
    langdockAuth,
    openrouterAuth,
    eligibleLangdockModels,
    eligibleOpenRouterModels,
  };
}

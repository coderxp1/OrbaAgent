import { randomUUID } from "node:crypto";

export class SecretManager {
  private static instance: SecretManager;
  private readonly secrets: Set<string> = new Set();
  private readonly secretLabels: Map<string, string> = new Map();

  constructor() {
    this.discoverHostSecrets();
  }

  public static getInstance(): SecretManager {
    if (!SecretManager.instance) {
      SecretManager.instance = new SecretManager();
    }
    return SecretManager.instance;
  }

  private discoverHostSecrets(): void {
    const sensitiveKeyPatterns = [
      /token/i,
      /secret/i,
      /password/i,
      /api_?key/i,
      /auth/i,
      /private/i,
      /credential/i,
    ];

    for (const [key, value] of Object.entries(process.env)) {
      if (!value || value.length < 6) continue;
      if (sensitiveKeyPatterns.some((pattern) => pattern.test(key))) {
        this.registerSecret(value, key);
      }
    }
  }

  public registerSecret(secret: string, label?: string): void {
    if (!secret || secret.trim().length < 4) return;
    const trimmed = secret.trim();
    this.secrets.add(trimmed);
    if (label) {
      this.secretLabels.set(trimmed, label);
    }
  }

  public registerSecrets(secretsMap: Record<string, string | undefined>): void {
    for (const [label, val] of Object.entries(secretsMap)) {
      if (val) {
        this.registerSecret(val, label);
      }
    }
  }

  public redact(text: string): string {
    if (!text || typeof text !== "string") return text;
    let redacted = text;

    // 1. Redact known registered secrets
    for (const secret of this.secrets) {
      if (secret.length >= 4 && redacted.includes(secret)) {
        redacted = redacted.split(secret).join("***REDACTED***");
      }
    }

    // 2. Redact heuristic patterns:
    // GitHub tokens
    redacted = redacted.replace(
      /(gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{22,})/g,
      "***REDACTED_GITHUB_TOKEN***",
    );

    // OpenAI / Generic sk- keys
    redacted = redacted.replace(/(sk-[A-Za-z0-9_\-]{20,})/g, "***REDACTED_API_KEY***");

    // Bearer tokens
    redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{15,}/gi, "$1***REDACTED_BEARER***");

    // Private keys
    redacted = redacted.replace(
      /-----BEGIN [A-Z\s]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+ PRIVATE KEY-----/g,
      "***REDACTED_PRIVATE_KEY***",
    );

    // URI credentials (e.g. postgres://user:password@host)
    redacted = redacted.replace(
      /([a-z]+:\/\/[^:\s]+:)([^@\s]+)(@)/gi,
      "$1***REDACTED_PASSWORD***$3",
    );

    return redacted;
  }

  public redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") {
      return this.redact(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }
    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const isSecretKey = /token|secret|password|key|auth|credential/i.test(k);
        if (isSecretKey && typeof v === "string") {
          result[k] = "***REDACTED***";
        } else {
          result[k] = this.redactObject(v);
        }
      }
      return result as unknown as T;
    }
    return obj;
  }

  /**
   * Sanitizes environment passed to child processes so that host secrets
   * (e.g. GITHUB_TOKEN, LANGDOCK_API_KEY, JWT_SECRET, etc.) are NOT leaked
   * into shell commands or child processes executing env / printenv.
   */
  public sanitizeChildEnv(
    baseEnv: Record<string, string | undefined> = process.env,
    allowListOverrides?: Record<string, string>,
  ): Record<string, string> {
    const sensitivePatterns = [
      /token/i,
      /secret/i,
      /password/i,
      /api_?key/i,
      /auth/i,
      /private/i,
      /credential/i,
      /database_url/i,
      /redis_url/i,
    ];

    const safeEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(baseEnv)) {
      if (value === undefined) continue;
      // Skip sensitive keys
      if (sensitivePatterns.some((pattern) => pattern.test(key))) {
        continue;
      }
      safeEnv[key] = value;
    }

    // Apply explicit allowList overrides if provided (and register them as secrets for redaction)
    if (allowListOverrides) {
      for (const [key, value] of Object.entries(allowListOverrides)) {
        if (value) {
          safeEnv[key] = value;
          this.registerSecret(value, key);
        }
      }
    }

    return safeEnv;
  }
}

import type { ToolExecutionResult } from "@orbaagent/shared";

/**
 * Machine-readable status returned when no real GPU media-generation backend is
 * deployed. Deliberately distinct from a generic failure so callers and the
 * capability report can distinguish "not built yet" from "broken".
 */
export const MEDIA_GENERATION_UNAVAILABLE = "MEDIA_GENERATION_UNAVAILABLE";

export interface MediaWorkerConfig {
  /** Worker base URL, e.g. `http://127.0.0.1:8190`. */
  url: string;
  /** Shared bearer token. Never has a source-code fallback. */
  token: string;
  /** Whether media generation is permitted at all (explicit opt-in). */
  enabled: boolean;
}

export interface MediaWorkerConfigState {
  config: MediaWorkerConfig | null;
  /** Human-readable reason the worker is not usable, when `config` is null. */
  reason: string | null;
  /** Stable machine-readable cause. */
  code:
    | typeof MEDIA_GENERATION_UNAVAILABLE
    | "MEDIA_WORKER_URL_NOT_CONFIGURED"
    | "MEDIA_WORKER_TOKEN_NOT_CONFIGURED"
    | null;
}

/**
 * Read GPU media worker configuration from the environment.
 *
 * There is intentionally **no default URL and no fallback token**. A previous
 * revision defaulted the token to a literal secret and the URL to a public IP,
 * which meant any deployment silently shipped a hardcoded shared secret and
 * reached a public endpoint. Both must now be supplied explicitly.
 *
 * `MEDIA_WORKER_ENABLED` must be `"true"` as an explicit opt-in. The real GPU
 * generation backend has not been deployed, so this defaults to disabled and the
 * media tools report {@link MEDIA_GENERATION_UNAVAILABLE} rather than returning
 * fabricated success.
 */
export function getMediaWorkerConfig(): MediaWorkerConfigState {
  const enabled = process.env.MEDIA_WORKER_ENABLED === "true";
  const url = (process.env.MEDIA_WORKER_URL || "").trim();
  const token = (process.env.MEDIA_WORKER_TOKEN || "").trim();

  if (!enabled) {
    return {
      config: null,
      code: MEDIA_GENERATION_UNAVAILABLE,
      reason:
        "The real GPU generation backend has not been deployed. Media generation is disabled; set MEDIA_WORKER_ENABLED=true only after a real diffusion/video backend is running.",
    };
  }

  if (!url) {
    return {
      config: null,
      code: "MEDIA_WORKER_URL_NOT_CONFIGURED",
      reason: "MEDIA_WORKER_URL is not configured.",
    };
  }

  if (!token) {
    return {
      config: null,
      code: "MEDIA_WORKER_TOKEN_NOT_CONFIGURED",
      reason: "MEDIA_WORKER_TOKEN is not configured.",
    };
  }

  return { config: { url, token, enabled }, reason: null, code: null };
}

/** Convenience predicate used by the capability report. */
export function isMediaGenerationConfigured(): boolean {
  return getMediaWorkerConfig().config !== null;
}

/**
 * Build the standard "not available" tool result. `success` is always `false`:
 * no generated artifact exists, so reporting success would be a false claim.
 */
export function unavailableMediaResult(
  toolCallId: string,
  toolName: string,
  startTime: number,
): ToolExecutionResult {
  const { reason, code } = getMediaWorkerConfig();
  const detail =
    reason ??
    "The real GPU generation backend has not been deployed. Media generation is unavailable.";

  // Log detailed diagnostics to server logs only, without secrets
  console.error(`[MEDIA GENERATION DIAGNOSTIC] ${toolName} failed: ${MEDIA_GENERATION_UNAVAILABLE} - ${detail} (Code: ${code})`);

  // Determine media type based on tool name for sanitized response
  const isVideo = toolName.includes("video");
  const sanitizedMessage = `${isVideo ? "Video" : "Image"} generation is temporarily unavailable. Please try again later.`;

  return {
    toolCallId,
    name: toolName,
    success: false,
    output: "",
    error: sanitizedMessage,
    metadata: { status: "UNAVAILABLE" }, // Mask internal status code
    executionTimeMs: Date.now() - startTime,
  };
}

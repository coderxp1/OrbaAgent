import type { ToolExecutionResult } from "@orbaagent/shared";

/**
 * Shape of the JSON body returned by the GPU worker's `/health` endpoint.
 * Only the fields we inspect are listed; the worker may return more.
 */
export interface GpuWorkerHealth {
  worker?: string;
  status?: string;
  capabilities?: {
    image_generation?: boolean;
    video_generation?: boolean;
    media_processing?: boolean;
  };
  generation_backend?: string | null;
  generation_video_backend?: string | null;
  unavailable_reason?: string | null;
}

/**
 * The exact substring the GPU worker includes in `unavailable_reason` when it
 * has a configured `generation_backend` (e.g. "diffusers") but has not loaded
 * model weights yet because it defers loading to the first request.
 */
const LAZY_LOAD_MARKER = "first request loads the weights";

/**
 * Returns `true` when the worker is healthy and has a real diffusers backend
 * configured, but model weights have not been loaded yet (lazy loading).
 *
 * The TypeScript tools must allow the generation request to proceed in this
 * state — the request itself will trigger model loading.
 */
export function isLazyLoadAllowed(health: GpuWorkerHealth | null): boolean {
  if (!health) return false;
  if (health.generation_backend !== "diffusers") return false;
  const imageRequested = (health as any).models?.image?.requested === true;
  const noImageError = !(health as any).models?.image?.load_error;
  if (imageRequested && noImageError) {
    return true;
  }
  if (typeof health.unavailable_reason !== "string") return false;
  return health.unavailable_reason.includes(LAZY_LOAD_MARKER);
}

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
        "The real GPU generation backend has not been deployed. Media generation is unavailable; set MEDIA_WORKER_ENABLED=true only after a real diffusion/video backend is running.",
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
  customReason?: string,
): ToolExecutionResult {
  const { reason, code } = getMediaWorkerConfig();
  const isVideo = toolName.includes("video");
  const detail =
    customReason ||
    reason ||
    `${isVideo ? "Video" : "Image"} generation is unavailable (Media processing service is offline or unconfigured).`;

  // Log detailed diagnostics to server logs only, without secrets
  console.error(
    `[MEDIA GENERATION DIAGNOSTIC] ${toolName} failed: ${MEDIA_GENERATION_UNAVAILABLE} - ${detail} (Code: ${code})`,
  );

  return {
    toolCallId,
    name: toolName,
    success: false,
    output: "",
    error: detail,
    metadata: { status: "UNAVAILABLE", code },
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Extended timeout for the first generation request, which must also load
 * model weights into GPU memory. FLUX schnell loads in ~20-30s on a 3090;
 * LTX-Video takes ~40-60s. 300s provides ample margin.
 */
export const FIRST_REQUEST_TIMEOUT_MS = 600_000;

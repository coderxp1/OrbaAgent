export interface ModelVramProfile {
  baseWeightMiB: number;
  estimatedKvContextMiB: number;
  maxParallelSlots: number;
}

export const KNOWN_MODEL_FOOTPRINTS: Record<string, ModelVramProfile> = {
  // Local Coding & LLM Models
  "qwen2.5-coder:32b": { baseWeightMiB: 20480, estimatedKvContextMiB: 6144, maxParallelSlots: 2 },
  "qwen2.5-coder:14b": { baseWeightMiB: 9216, estimatedKvContextMiB: 4096, maxParallelSlots: 4 },
  "qwen2.5-coder:7b": { baseWeightMiB: 4812, estimatedKvContextMiB: 2048, maxParallelSlots: 4 },
  "llama3.3:70b": { baseWeightMiB: 43520, estimatedKvContextMiB: 8192, maxParallelSlots: 2 },
  "qwen2.5:72b": { baseWeightMiB: 44544, estimatedKvContextMiB: 8192, maxParallelSlots: 2 },
  "deepseek-coder-v2:16b": {
    baseWeightMiB: 9112,
    estimatedKvContextMiB: 4096,
    maxParallelSlots: 4,
  },
  "codestral:22b": { baseWeightMiB: 13312, estimatedKvContextMiB: 4096, maxParallelSlots: 2 },
  "qwen3-vl:8b": { baseWeightMiB: 6144, estimatedKvContextMiB: 3072, maxParallelSlots: 2 },
  "mistral-small:24b": { baseWeightMiB: 14540, estimatedKvContextMiB: 4096, maxParallelSlots: 2 },
  "phi4:14b": { baseWeightMiB: 9320, estimatedKvContextMiB: 3072, maxParallelSlots: 4 },
};

export interface RuntimeGpuTelemetry {
  measuredUsedMiB: number;
  measuredFreeMiB: number;
  totalMiB: number;
  timestamp: Date;
}

export interface AdmissionDecision {
  admitted: boolean;
  action: "EXECUTE_LOCAL" | "ESCALATE_TO_CLOUD" | "QUEUE";
  reason: string;
  totalEstimatedVramMiB: number;
  headroomRemainingMiB: number;
}

export class GpuAdmissionController {
  public readonly totalGpu1VramMiB: number;
  public readonly safetyHeadroomMiB: number;
  public readonly runtimeWorkspaceOverheadMiB: number;
  private mediaWorkerVramReservationMiB = 0;
  private activeLocalInferences: Map<string, number> = new Map();
  private runtimeTelemetry?: RuntimeGpuTelemetry;
  public allowConcurrentMediaAndLlm = false;

  constructor(
    totalVramMiB = 97887, // Physical RTX 6000 Ada/Blackwell VRAM (95.6 GiB)
    safetyHeadroomMiB = 8192, // Mandatory 8 GB headroom for OS, driver scratch, PyTorch cache
    runtimeWorkspaceOverheadMiB = 4096, // 4 GB reserved for CUDA runtime, temporary activation buffers, scratchpad
  ) {
    this.totalGpu1VramMiB = totalVramMiB;
    this.safetyHeadroomMiB = safetyHeadroomMiB;
    this.runtimeWorkspaceOverheadMiB = runtimeWorkspaceOverheadMiB;
  }

  public getUsableVramMiB(): number {
    return this.totalGpu1VramMiB - this.safetyHeadroomMiB;
  }

  public updateTelemetry(telemetry: RuntimeGpuTelemetry): void {
    this.runtimeTelemetry = telemetry;
  }

  public getTelemetry(): RuntimeGpuTelemetry | undefined {
    return this.runtimeTelemetry;
  }

  public setMediaActive(active: boolean, kind: "image" | "video" = "image"): void {
    if (!active) {
      this.mediaWorkerVramReservationMiB = 0;
    } else {
      // FLUX.1-schnell ~24 GB; Wan2.1 ~14 GB
      this.mediaWorkerVramReservationMiB = kind === "image" ? 24576 : 14336;
    }
  }

  public getMediaReservationMiB(): number {
    return this.mediaWorkerVramReservationMiB;
  }

  public getActiveInferenceCount(): number {
    let count = 0;
    for (const c of this.activeLocalInferences.values()) {
      count += c;
    }
    return count;
  }

  public evaluateAdmission(modelId: string): AdmissionDecision {
    // 1. Mandatory empirical safety boundary: disallow concurrent media + LLM until benchmarked
    if (this.mediaWorkerVramReservationMiB > 0 && !this.allowConcurrentMediaAndLlm) {
      return {
        admitted: false,
        action: "ESCALATE_TO_CLOUD",
        reason: `Media runtime currently active on GPU 1 (${this.mediaWorkerVramReservationMiB} MiB reserved). Concurrent LLM + media inference is disallowed prior to empirical GPU 1 benchmarking. Escalating to cloud.`,
        totalEstimatedVramMiB: this.mediaWorkerVramReservationMiB,
        headroomRemainingMiB: this.totalGpu1VramMiB - this.mediaWorkerVramReservationMiB,
      };
    }

    const profile = KNOWN_MODEL_FOOTPRINTS[modelId] || {
      baseWeightMiB: 20480, // Safe default assumption: ~20 GB
      estimatedKvContextMiB: 6144,
      maxParallelSlots: 2,
    };

    // Incremental requirement includes weights, KV context, and temporary CUDA/inference allocations
    const incrementalRequired =
      profile.baseWeightMiB + profile.estimatedKvContextMiB + this.runtimeWorkspaceOverheadMiB;

    // 2. Telemetry-aware runtime evaluation (uses real GPU measurements if available)
    if (this.runtimeTelemetry) {
      const liveFree = this.runtimeTelemetry.measuredFreeMiB;
      const headroomAfter = liveFree - incrementalRequired;

      if (headroomAfter < this.safetyHeadroomMiB) {
        return {
          admitted: false,
          action: "ESCALATE_TO_CLOUD",
          reason: `Live GPU 1 telemetry rejected admission: measured free VRAM is ${liveFree} MiB; incremental requirement is ${incrementalRequired} MiB; leaves only ${headroomAfter} MiB (minimum safety headroom is ${this.safetyHeadroomMiB} MiB). Escalating to cloud.`,
          totalEstimatedVramMiB: this.runtimeTelemetry.measuredUsedMiB + incrementalRequired,
          headroomRemainingMiB: headroomAfter,
        };
      }
    }

    // 3. Static planning budget evaluation (fail-closed fallback when telemetry is not yet polled)
    const totalRequired = incrementalRequired + this.mediaWorkerVramReservationMiB;
    const remainingHeadroom = this.totalGpu1VramMiB - totalRequired;

    if (remainingHeadroom < this.safetyHeadroomMiB) {
      return {
        admitted: false,
        action: "ESCALATE_TO_CLOUD",
        reason: `GPU 1 VRAM budget exceeded: requires ${totalRequired} MiB (including ${this.mediaWorkerVramReservationMiB} MiB media reservation and ${this.runtimeWorkspaceOverheadMiB} MiB workspace), leaves only ${remainingHeadroom} MiB (minimum safety headroom is ${this.safetyHeadroomMiB} MiB).`,
        totalEstimatedVramMiB: totalRequired,
        headroomRemainingMiB: remainingHeadroom,
      };
    }

    // 4. Concurrency slot saturation check
    const active = this.activeLocalInferences.get(modelId) || 0;
    if (active >= profile.maxParallelSlots) {
      return {
        admitted: false,
        action: "ESCALATE_TO_CLOUD",
        reason: `Local model ${modelId} concurrency saturated (${active}/${profile.maxParallelSlots} slots active). Escalating to cloud.`,
        totalEstimatedVramMiB: totalRequired,
        headroomRemainingMiB: remainingHeadroom,
      };
    }

    return {
      admitted: true,
      action: "EXECUTE_LOCAL",
      reason: `Admitted on GPU 1: ${totalRequired} MiB reserved, ${remainingHeadroom} MiB headroom remaining.`,
      totalEstimatedVramMiB: totalRequired,
      headroomRemainingMiB: remainingHeadroom,
    };
  }

  public acquire(modelId: string): boolean {
    const decision = this.evaluateAdmission(modelId);
    if (!decision.admitted) return false;
    const current = this.activeLocalInferences.get(modelId) || 0;
    this.activeLocalInferences.set(modelId, current + 1);
    return true;
  }

  public release(modelId: string): void {
    const current = this.activeLocalInferences.get(modelId) || 0;
    if (current <= 1) {
      this.activeLocalInferences.delete(modelId);
    } else {
      this.activeLocalInferences.set(modelId, current - 1);
    }
  }

  public acquireSlot(modelId: string): boolean {
    return this.acquire(modelId);
  }

  public releaseSlot(modelId: string): void {
    this.release(modelId);
  }

  public reset(): void {
    this.mediaWorkerVramReservationMiB = 0;
    this.activeLocalInferences.clear();
    this.runtimeTelemetry = undefined;
    this.allowConcurrentMediaAndLlm = false;
  }
}

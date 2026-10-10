import { describe, expect, it } from "vitest";
import {
  GpuAdmissionController,
  KNOWN_MODEL_FOOTPRINTS,
} from "./admission.js";

describe("GpuAdmissionController (Resource & VRAM Admission)", () => {
  it("admits standard models when GPU 1 is idle and within budget", () => {
    const controller = new GpuAdmissionController(97887, 8192);

    const decision32b = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(decision32b.admitted).toBe(true);
    expect(decision32b.action).toBe("EXECUTE_LOCAL");
    expect(decision32b.headroomRemainingMiB).toBeGreaterThan(8192);

    const decision70b = controller.evaluateAdmission("llama3.3:70b");
    expect(decision70b.admitted).toBe(true);
    expect(decision70b.action).toBe("EXECUTE_LOCAL");
    expect(decision70b.headroomRemainingMiB).toBeGreaterThan(8192);
  });

  it("escalates to cloud when total memory requirements exceed safety headroom", () => {
    // Simulated constrained GPU with 32 GB total VRAM
    const constrainedController = new GpuAdmissionController(32768, 8192);

    // 70B model requires ~51 GB VRAM (base + KV)
    const decision70b = constrainedController.evaluateAdmission("llama3.3:70b");
    expect(decision70b.admitted).toBe(false);
    expect(decision70b.action).toBe("ESCALATE_TO_CLOUD");
    expect(decision70b.reason).toContain("GPU 1 VRAM budget exceeded");
    expect(decision70b.headroomRemainingMiB).toBeLessThan(8192);
  });

  it("enforces strict mutual exclusion against active media worker prior to empirical benchmarking", () => {
    const controller = new GpuAdmissionController(97887, 8192);

    // When media is idle, a 32B model fits comfortably
    expect(controller.getMediaReservationMiB()).toBe(0);
    const decisionBeforeMedia = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(decisionBeforeMedia.admitted).toBe(true);

    // Media worker starts FLUX image generation (~24 GB reservation)
    controller.setMediaActive(true, "image");
    expect(controller.getMediaReservationMiB()).toBe(24576);

    // By default (allowConcurrentMediaAndLlm = false), concurrent execution is strictly blocked
    const decisionDuringMedia = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(decisionDuringMedia.admitted).toBe(false);
    expect(decisionDuringMedia.action).toBe("ESCALATE_TO_CLOUD");
    expect(decisionDuringMedia.reason).toContain("disallowed prior to empirical GPU 1 benchmarking");

    // Once media completes, local admission recovers
    controller.setMediaActive(false);
    expect(controller.getMediaReservationMiB()).toBe(0);
    const decisionRecovered = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(decisionRecovered.admitted).toBe(true);
  });

  it("evaluates admission against live measured GPU telemetry", () => {
    const controller = new GpuAdmissionController(97887, 8192);

    // 1. Live telemetry reports ample free VRAM (e.g. 70,000 MiB free)
    controller.updateTelemetry({
      measuredUsedMiB: 27887,
      measuredFreeMiB: 70000,
      totalMiB: 97887,
      timestamp: new Date(),
    });
    const healthyDecision = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(healthyDecision.admitted).toBe(true);
    expect(healthyDecision.action).toBe("EXECUTE_LOCAL");

    // 2. Live telemetry reports constrained free VRAM (e.g. 15,000 MiB free)
    // 32B requires ~20.5 GB weights + 6.1 GB KV + 4 GB workspace = 30.7 GB > 15 GB
    controller.updateTelemetry({
      measuredUsedMiB: 82887,
      measuredFreeMiB: 15000,
      totalMiB: 97887,
      timestamp: new Date(),
    });
    const constrainedDecision = controller.evaluateAdmission("qwen2.5-coder:32b");
    expect(constrainedDecision.admitted).toBe(false);
    expect(constrainedDecision.action).toBe("ESCALATE_TO_CLOUD");
    expect(constrainedDecision.reason).toContain("Live GPU 1 telemetry rejected admission");
  });

  it("enforces concurrency slot saturation and escalates overflow requests", () => {
    const controller = new GpuAdmissionController(97887, 8192);
    const modelId = "qwen2.5-coder:32b";
    const maxSlots = KNOWN_MODEL_FOOTPRINTS[modelId].maxParallelSlots;

    expect(maxSlots).toBe(2);

    // Acquire all slots
    expect(controller.acquireSlot(modelId)).toBe(true);
    expect(controller.acquireSlot(modelId)).toBe(true);
    expect(controller.getActiveInferenceCount()).toBe(2);

    // Third request exceeds concurrency -> escalates
    const overflowDecision = controller.evaluateAdmission(modelId);
    expect(overflowDecision.admitted).toBe(false);
    expect(overflowDecision.action).toBe("ESCALATE_TO_CLOUD");
    expect(overflowDecision.reason).toContain("concurrency saturated");

    // Acquire fails when saturated
    expect(controller.acquireSlot(modelId)).toBe(false);

    // Release one slot -> admission recovers
    controller.releaseSlot(modelId);
    expect(controller.getActiveInferenceCount()).toBe(1);

    const recoveredDecision = controller.evaluateAdmission(modelId);
    expect(recoveredDecision.admitted).toBe(true);
    expect(controller.acquireSlot(modelId)).toBe(true);

    // Release remaining slots
    controller.releaseSlot(modelId);
    controller.releaseSlot(modelId);
    expect(controller.getActiveInferenceCount()).toBe(0);
  });
});

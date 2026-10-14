import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentMemoryManager,
  ChangeReviewManager,
  TaskPlanManager,
  ToolRegistry,
} from "@orbaagent/agent-runtime";
import { ModelGateway } from "@orbaagent/model-gateway";
import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "./orchestrator.js";

describe("Autonomous Coding Loop: Plan -> Execute -> Verify -> Repair -> Complete", () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "orba-autonomous-test-"));
    TaskPlanManager.resetInstance();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("autonomously plans, detects an injected test failure, repairs the file, reruns verification, and completes with evidence", async () => {
    // 1. Setup real project files in temporary workspace
    const srcDir = path.join(tempWorkspace, "src");
    await fs.mkdir(srcDir, { recursive: true });

    // Intentionally broken implementation: adds 1 extra to the sum
    const bugCode = `export function add(a: number, b: number): number {\n  return a + b + 1;\n}\n`;
    await fs.writeFile(path.join(srcDir, "math.ts"), bugCode, "utf-8");

    // Verification test script that exits with 1 on bug, 0 on fix
    const testScript = path.join(tempWorkspace, "test-runner.js");
    const testRunnerContent = `
const fs = require('fs');
const content = fs.readFileSync('src/math.ts', 'utf8');
if (content.includes('a + b + 1')) {
  console.error('FAIL: add(1, 2) expected 3 but returned 4');
  process.exit(1);
} else if (content.includes('a + b;')) {
  console.log('PASS: all 2 math tests passed (100% assertions satisfied)');
  process.exit(0);
} else {
  console.error('FAIL: unrecognized implementation');
  process.exit(1);
}
`;
    await fs.writeFile(testScript, testRunnerContent.trim(), "utf-8");

    const mockGateway = new ModelGateway();
    let turn = 0;

    // Model behavior simulating the complete autonomous control loop
    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      const traceId = req.trace.traceId;

      if (turn === 1) {
        // Step A: Autonomous Planning
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_plan_1",
            name: "task_plan",
            arguments: {
              goal: "Fix bug in src/math.ts and verify test suite passes",
              steps: [
                {
                  id: "step-diagnose",
                  title: "Inspect source code and run failing test to diagnose error",
                  dependencies: [],
                  acceptanceCriteria: ["Identify the faulty addition logic in src/math.ts"],
                },
                {
                  id: "step-repair",
                  title: "Repair src/math.ts to return correct sum",
                  dependencies: ["step-diagnose"],
                  acceptanceCriteria: ["math.ts returns a + b without any extra offset"],
                },
                {
                  id: "step-verify",
                  title: "Run verification test runner",
                  dependencies: ["step-repair"],
                  acceptanceCriteria: ["test-runner.js exits with code 0"],
                },
              ],
              verificationCriteria: ["node test-runner.js passes with code 0"],
            },
          },
        };
      } else if (turn === 2) {
        // Step B: Mark step-diagnose running, search tools, and run the test to see failure
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_step_diag",
            name: "task_step",
            arguments: {
              step_id: "step-diagnose",
              action: "start",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_search_tools",
            name: "tools_search",
            arguments: { query: "execute_shell write_file edit_file" },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_run_failing_test",
            name: "execute_shell",
            arguments: { command: "node test-runner.js" },
          },
        };
      } else if (turn === 3) {
        // Step C: Failure detected! Record diagnosis and complete step-diagnose, start step-repair, and repair the file
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_diag_done",
            name: "task_step",
            arguments: {
              step_id: "step-diagnose",
              action: "complete",
              evidence: "node test-runner.js failed: FAIL: add(1, 2) expected 3 but returned 4",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_repair_start",
            name: "task_step",
            arguments: {
              step_id: "step-repair",
              action: "start",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_fix_file",
            name: "write_file",
            arguments: {
              path: "src/math.ts",
              content: `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
            },
          },
        };
      } else if (turn === 4) {
        // Step D: Repair applied. Complete step-repair, start step-verify, rerun test
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_repair_done",
            name: "task_step",
            arguments: {
              step_id: "step-repair",
              action: "complete",
              evidence: "Replaced 'a + b + 1' with 'a + b' in src/math.ts",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_verify_start",
            name: "task_step",
            arguments: {
              step_id: "step-verify",
              action: "start",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_run_verified_test",
            name: "execute_shell",
            arguments: { command: "node test-runner.js" },
          },
        };
      } else if (turn === 5) {
        // Step E: Verification succeeded! Record evidence on step-verify and complete task with verified evidence
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_verify_done",
            name: "task_step",
            arguments: {
              step_id: "step-verify",
              action: "complete",
              evidence: "PASS: all 2 math tests passed (100% assertions satisfied)",
            },
          },
        };
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_final_complete",
            name: "task_complete",
            arguments: {
              summary: "Fixed bug in src/math.ts. Verified that node test-runner.js passed with code 0.",
              verified: true,
              verificationEvidence: "PASS: all 2 math tests passed (100% assertions satisfied)",
            },
          },
        };
      }
    });

    const orchestrator = new AgentOrchestrator({
      gateway: mockGateway,
      workspacePath: tempWorkspace,
      maxIterations: 8,
      autoApprove: true,
    });

    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Fix failing math test in workspace" }],
      stream: true,
      trace: {
        traceId: "test_autonomous_coding_loop",
        tenantId: "tenant_autonomous",
        userId: "user_autonomous",
        conversationId: "conv_autonomous",
        agentRunId: "run_autonomous_loop",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    // 1. Confirm loop executed all 5 turns to verified completion
    expect(turn).toBe(5);

    // 2. Confirm structured plan was created and plan update events were emitted
    const planUpdatedEvents = events.filter((e) => e.type === "task_plan_updated");
    expect(planUpdatedEvents.length).toBeGreaterThanOrEqual(1);
    const initialPlan = planUpdatedEvents[0]?.taskPlan;
    expect(initialPlan).toBeDefined();
    expect(initialPlan?.goal).toContain("Fix bug in src/math.ts");
    expect(initialPlan?.steps.length).toBe(3);

    // 3. Confirm step updates were tracked and emitted
    const stepUpdatedEvents = events.filter((e) => e.type === "task_step_updated");
    expect(stepUpdatedEvents.length).toBeGreaterThanOrEqual(3);

    // 4. Confirm real file modifications were recorded in ChangeReviewManager
    const fileChangeEvents = events.filter((e) => e.type === "file_changes_detected");
    expect(fileChangeEvents.length).toBe(1);
    const mathChange = fileChangeEvents[0]?.changes?.find((c) => c.path === "src/math.ts");
    expect(mathChange).toBeDefined();
    expect(mathChange?.status).toBe("modified");

    // 5. Verify the actual file on disk was modified to the correct fix
    const updatedContent = await fs.readFile(path.join(srcDir, "math.ts"), "utf-8");
    expect(updatedContent).toContain("return a + b;");
    expect(updatedContent).not.toContain("a + b + 1");

    // 6. Confirm task completion succeeded and emitted final done
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    const completeResult = toolResults.find((r) => r.toolResult?.name === "task_complete");
    expect(completeResult?.toolResult?.success).toBe(true);
    expect(completeResult?.toolResult?.output).toContain("[TASK_COMPLETE] Verified Success");

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.finishReason).toBe("stop");
  });

  it("prevents false-completion when task_complete is called while active steps are unfulfilled or unverified", async () => {
    const mockGateway = new ModelGateway();
    let turn = 0;

    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      const traceId = req.trace.traceId;

      if (turn === 1) {
        // Create plan with 2 steps
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_plan",
            name: "task_plan",
            arguments: {
              goal: "Implement authentication and database schema",
              steps: [
                { id: "step-auth", title: "Write auth handler", acceptanceCriteria: ["Tests pass"] },
                { id: "step-db", title: "Apply db migration", acceptanceCriteria: ["Migration applied"] },
              ],
            },
          },
        };
      } else if (turn === 2) {
        // Prematurely call task_complete while neither step is completed!
        yield {
          type: "tool_call_start",
          traceId,
          toolCall: {
            id: "call_false_complete",
            name: "task_complete",
            arguments: {
              summary: "I finished everything without running anything!",
              verified: true,
            },
          },
        };
      } else {
        // Turn 3: Assistant concludes after being rejected
        yield {
          type: "text_delta",
          traceId,
          textDelta: "I acknowledge that steps are incomplete and I cannot declare completion.",
        };
      }
    });

    const orchestrator = new AgentOrchestrator({
      gateway: mockGateway,
      workspacePath: tempWorkspace,
      maxIterations: 4,
      autoApprove: true,
    });

    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Do the task" }],
      stream: true,
      trace: {
        traceId: "test_false_completion_prevention",
        tenantId: "tenant_false_complete",
        userId: "user_false_complete",
        conversationId: "conv_false_complete",
        agentRunId: "run_false_complete",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    // task_complete must have been rejected!
    const completeResult = events.find(
      (e) => e.type === "tool_call_result" && e.toolResult?.name === "task_complete",
    );
    expect(completeResult).toBeDefined();
    expect(completeResult?.toolResult?.success).toBe(false);
    expect(completeResult?.toolResult?.error).toContain("Cannot complete task");
    expect(completeResult?.toolResult?.error).toContain("Incomplete steps remaining");
  });

  it("supports serialized task plan persistence and clean resumption without repeating completed work", () => {
    const manager = TaskPlanManager.getInstance();
    const plan = manager.createPlan({
      goal: "Build payment gateway",
      workspaceId: "tenant_resume_test",
      steps: [
        { id: "step-1", title: "Setup config", status: "completed" },
        { id: "step-2", title: "Implement stripe connector", status: "pending", dependencies: ["step-1"] },
        { id: "step-3", title: "Run end-to-end tests", status: "pending", dependencies: ["step-2"] },
      ],
    });

    // Serialize state
    const serialized = manager.serialize(plan.planId);
    expect(serialized).toContain("step-1");
    expect(serialized).toContain('"status": "completed"');

    // Reset in-memory manager
    TaskPlanManager.resetInstance();
    const freshManager = TaskPlanManager.getInstance();
    expect(freshManager.getActivePlan("tenant_resume_test")).toBeUndefined();

    // Restore state
    const restored = freshManager.restorePlan(serialized);
    expect(restored.planId).toBe(plan.planId);
    expect(freshManager.getActivePlan("tenant_resume_test")).toBeDefined();

    // Next executable step must be step-2 (step-1 is already done and not repeated)
    const nextStep = freshManager.getNextExecutableStep(plan.planId);
    expect(nextStep?.id).toBe("step-2");
  });
});

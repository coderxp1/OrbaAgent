import { describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "./orchestrator.js";
import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { ModelGateway } from "@orbaagent/model-gateway";
import { ToolRegistry } from "@orbaagent/agent-runtime";

describe("AgentOrchestrator State Machine & Autonomous Execution", () => {
  it("executes multi-step sequential tool calls to completion without stopping", async () => {
    const mockGateway = new ModelGateway();
    let turn = 0;

    // Simulate multi-step tool calls: step 1 tool_call -> step 2 tool_call -> step 3 task_complete
    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_step1",
            name: "execute_shell",
            arguments: { command: "echo step 1" },
          },
        };
      } else if (turn === 2) {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_step2",
            name: "execute_shell",
            arguments: { command: "echo step 2" },
          },
        };
      } else {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_step3",
            name: "task_complete",
            arguments: { summary: "All multi-step commands executed successfully.", verified: true },
          },
        };
      }
    });

    const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Run multi-step workflow" }],
      stream: true,
      trace: {
        traceId: "test_multi_step",
        tenantId: "tenant_test",
        userId: "user_test",
        conversationId: "conv_test",
        agentRunId: "run_multi_step",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    expect(turn).toBe(3);
    const commandStartEvents = events.filter((e) => e.type === "terminal_command_start");
    expect(commandStartEvents.length).toBe(2);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.finishReason).toBe("stop");
  });

  it("recovers and auto-continues when model outputs transitional text without a tool call mid-workflow", async () => {
    const mockGateway = new ModelGateway();
    let turn = 0;

    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_install",
            name: "execute_shell",
            arguments: { command: "echo packages installed" },
          },
        };
      } else if (turn === 2) {
        // Transitional text without tool calls (the exact bug from media_1791207424276.png)
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta: "Dependencies installed. Now let me run the type checker and linter.",
        };
      } else if (turn === 3) {
        // Orchestrator automatically injected continuation directive; agent proceeds with next tool!
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_verify",
            name: "execute_shell",
            arguments: { command: "echo typecheck passed" },
          },
        };
      } else {
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta: "All checks verified and passing cleanly.",
        };
      }
    });

    const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 6 });
    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Install and verify dependencies" }],
      stream: true,
      trace: {
        traceId: "test_auto_continue",
        tenantId: "tenant_test",
        userId: "user_test",
        conversationId: "conv_test",
        agentRunId: "run_auto_continue",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    // Must have continued through turn 3 and completed at turn 4 without stopping at turn 2!
    expect(turn).toBe(4);
    const autoContEvents = events.filter(
      (e) => e.type === "agent_activity" && e.activity?.step === "Auto-continuing workflow",
    );
    expect(autoContEvents.length).toBe(1);
  });

  it("handles tool failure and allows agent to recover in next iteration", async () => {
    const mockGateway = new ModelGateway();
    let turn = 0;

    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_fail",
            name: "execute_shell",
            arguments: { command: "exit 1" },
          },
        };
      } else if (turn === 2) {
        // Agent observes failure and runs recovery command
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_fix",
            name: "execute_shell",
            arguments: { command: "echo fixed" },
          },
        };
      } else {
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta: "Recovered from initial error and resolved cleanly.",
        };
      }
    });

    const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Run resilient command" }],
      stream: true,
      trace: {
        traceId: "test_recovery",
        tenantId: "tenant_test",
        userId: "user_test",
        conversationId: "conv_test",
        agentRunId: "run_recovery",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    expect(turn).toBe(3);
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults.length).toBe(2);
  });

  it("initiates turn 0 with ONLY core tools, emits permission and audit events, and dynamically discovers tools", async () => {
    const mockGateway = new ModelGateway();
    let turn = 0;
    const toolsInEachTurn: number[] = [];

    vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
      turn++;
      toolsInEachTurn.push(req.tools?.length || 0);

      if (turn === 1) {
        // Turn 1: Model uses tools_search to find git tools
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_search_tools",
            name: "tools_search",
            arguments: { query: "git status commit" },
          },
        };
      } else if (turn === 2) {
        // Turn 2: Discovered execute_git is now active! Model uses execute_git
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_git_status",
            name: "execute_git",
            arguments: { action: "status" },
          },
        };
      } else {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: {
            id: "call_complete",
            name: "task_complete",
            arguments: { summary: "Git status completed", verified: true },
          },
        };
      }
    });

    const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
    const request: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Check git status" }],
      stream: true,
      trace: {
        traceId: "test_dynamic_discovery",
        tenantId: "tenant_dyn",
        userId: "user_dyn",
        conversationId: "conv_dyn",
        agentRunId: "run_dyn",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of orchestrator.executeAgentLoop(request)) {
      events.push(event);
    }

    expect(turn).toBe(3);

    // Turn 1 had ONLY core tools injected (tools_search, environment_inspect, capabilities_inspect, task_complete)
    expect(toolsInEachTurn[0]).toBe(4);

    // Turn 2 had dynamically expanded active tools including execute_git
    expect(toolsInEachTurn[1]).toBeGreaterThan(4);

    // Events emitted include permission_requested, permission_granted, audit_logged, tools_discovered
    const permReqEvents = events.filter((e) => e.type === "permission_requested");
    expect(permReqEvents.length).toBeGreaterThanOrEqual(2);

    const permGrantEvents = events.filter((e) => e.type === "permission_granted");
    expect(permGrantEvents.length).toBeGreaterThanOrEqual(2);

    const auditEvents = events.filter((e) => e.type === "audit_logged");
    expect(auditEvents.length).toBeGreaterThanOrEqual(2);

    const discoveredEvents = events.filter((e) => e.type === "tools_discovered");
    expect(discoveredEvents.length).toBe(1);
    expect(discoveredEvents[0].discoveredTools).toContain("execute_git");
  });
});


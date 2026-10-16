import { ToolRegistry } from "@orbaagent/agent-runtime";
import { ModelGateway } from "@orbaagent/model-gateway";
import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "./orchestrator.js";

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
            arguments: {
              summary: "All multi-step commands executed successfully.",
              verified: true,
            },
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

    // Turn 1 had ONLY core tools injected (task_plan, task_step, tools_search, environment_inspect, capabilities_inspect, task_complete)
    expect(toolsInEachTurn[0]).toBe(6);

    // Turn 2 had dynamically expanded active tools including execute_git
    expect(toolsInEachTurn[1]).toBeGreaterThan(6);

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

  describe("Conversation-First Policy & Shell Prevention Regression Suite", () => {
    it("1. Greetings and general questions complete with zero tool calls and zero shell execution", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      let toolsPassedToModel: unknown[] | undefined;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsPassedToModel = req.tools;
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta:
            "Hello! I am doing well, thank you. How can I help you with your project today?",
        };
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Hey Orba, how are you?" }],
        stream: true,
        trace: {
          traceId: "test_greeting",
          tenantId: "tenant_conv",
          userId: "user_conv",
          conversationId: "conv_greet",
          agentRunId: "run_greet",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      // Must complete in exactly 1 turn
      expect(turns).toBe(1);

      // Model must have been provided 0 tools in its definition list
      expect(toolsPassedToModel).toBeDefined();
      expect(toolsPassedToModel?.length).toBe(0);

      // Absolute zero tool calls and zero shell commands
      const toolCalls = events.filter((e) => e.type === "tool_call_start");
      const shellCommands = events.filter((e) => e.type === "terminal_command_start");
      expect(toolCalls.length).toBe(0);
      expect(shellCommands.length).toBe(0);
    });

    it("2. Technical explanations and idea feedback do not trigger shell execution", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      let toolsPassed: unknown[] | undefined;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsPassed = req.tools;
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta:
            "AI agents perceive their environment through inputs, reason using an LLM, and take actions using tools.",
        };
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Explain how AI agents work." }],
        stream: true,
        trace: {
          traceId: "test_explanation",
          tenantId: "tenant_conv",
          userId: "user_conv",
          conversationId: "conv_expl",
          agentRunId: "run_expl",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      expect(turns).toBe(1);
      expect(toolsPassed?.length).toBe(0);
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
      expect(events.filter((e) => e.type === "tool_call_start").length).toBe(0);
    });

    it("2b. Media capability questions ('Can you generate images?', 'Can you generate videos?') complete with zero tool calls and truthful answers", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      let toolsPassed: unknown[] | undefined;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsPassed = req.tools;
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta:
            "Yes, I can generate high-quality images using FLUX.1 and videos using Wan2.1. What would you like to create?",
        };
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Can you generate images?" }],
        stream: true,
        trace: {
          traceId: "test_media_cap_query",
          tenantId: "tenant_conv",
          userId: "user_conv",
          conversationId: "conv_cap",
          agentRunId: "run_cap",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      expect(turns).toBe(1);
      expect(toolsPassed?.length).toBe(0);
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
      expect(events.filter((e) => e.type === "tool_call_start").length).toBe(0);
    });

    it("3. Image requests activate image generation without shell execution", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      const toolsInTurn: string[][] = [];

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsInTurn.push((req.tools || []).map((t: any) => t.name));

        if (turns === 1) {
          yield {
            type: "tool_call_start",
            traceId: req.trace.traceId,
            toolCall: {
              id: "call_image_gen",
              name: "media_image_generate",
              arguments: {
                prompt: "a black obsidian sphere on a slate pedestal",
                width: 512,
                height: 512,
              },
            },
          };
        } else {
          yield {
            type: "text_delta",
            traceId: req.trace.traceId,
            textDelta:
              "Here is your generated image: https://orbaagent.dev/api/artifacts/default-tenant/img_123/image.png",
          };
        }
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Generate an image of a black obsidian sphere." }],
        stream: true,
        trace: {
          traceId: "test_image_req",
          tenantId: "tenant_media",
          userId: "user_media",
          conversationId: "conv_img",
          agentRunId: "run_img",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      // Turn 1 had ONLY media_image_generate (no execute_shell, no tools_search, no task_plan)
      expect(toolsInTurn[0]).toContain("media_image_generate");
      expect(toolsInTurn[0]).not.toContain("execute_shell");
      expect(toolsInTurn[0]).not.toContain("tools_search");
      expect(toolsInTurn[0]).not.toContain("task_plan");

      // Exactly media_image_generate executed, zero shell commands
      const toolStarts = events.filter((e) => e.type === "tool_call_start");
      expect(toolStarts.length).toBe(1);
      expect(toolStarts[0].toolCall?.name).toBe("media_image_generate");
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
    });

    it("4. Video requests activate video generation without shell execution", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      const toolsInTurn: string[][] = [];

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsInTurn.push((req.tools || []).map((t: any) => t.name));

        if (turns === 1) {
          yield {
            type: "tool_call_start",
            traceId: req.trace.traceId,
            toolCall: {
              id: "call_video_gen",
              name: "media_video_generate",
              arguments: {
                prompt: "ocean wave at sunset",
                duration_seconds: 2,
                width: 480,
                height: 480,
              },
            },
          };
        } else {
          yield {
            type: "text_delta",
            traceId: req.trace.traceId,
            textDelta:
              "Here is your generated video: https://orbaagent.dev/api/artifacts/default-tenant/vid_456/video.mp4",
          };
        }
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [
          { role: "user", content: "Create a two-second video of an ocean wave at sunset." },
        ],
        stream: true,
        trace: {
          traceId: "test_video_req",
          tenantId: "tenant_media",
          userId: "user_media",
          conversationId: "conv_vid",
          agentRunId: "run_vid",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      // Turn 1 had ONLY media_video_generate
      expect(toolsInTurn[0]).toContain("media_video_generate");
      expect(toolsInTurn[0]).not.toContain("execute_shell");
      expect(toolsInTurn[0]).not.toContain("tools_search");

      const toolStarts = events.filter((e) => e.type === "tool_call_start");
      expect(toolStarts.length).toBe(1);
      expect(toolStarts[0].toolCall?.name).toBe("media_video_generate");
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
    });

    it("5. Actual coding, installation, testing, and infrastructure tasks can still use shell tools", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        if (turns === 1) {
          yield {
            type: "tool_call_start",
            traceId: req.trace.traceId,
            toolCall: {
              id: "call_test_run",
              name: "execute_shell",
              arguments: { command: "echo test runner ok" },
            },
          };
        } else {
          yield {
            type: "text_delta",
            traceId: req.trace.traceId,
            textDelta: "All tests executed successfully.",
          };
        }
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Run the test suite." }],
        stream: true,
        trace: {
          traceId: "test_sys_op",
          tenantId: "tenant_eng",
          userId: "user_eng",
          conversationId: "conv_test_suite",
          agentRunId: "run_test_suite",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      expect(turns).toBe(2);
      const shellEvents = events.filter((e) => e.type === "terminal_command_start");
      expect(shellEvents.length).toBe(1);
      expect((shellEvents[0] as any).command).toBe("echo test runner ok");
    });

    it("6. Ambiguous requests do not cause speculative execution", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;
      let toolsPassed: unknown[] | undefined;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        toolsPassed = req.tools;
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta: "Could you please clarify what you would like me to do?",
        };
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "do it" }],
        stream: true,
        trace: {
          traceId: "test_ambiguous",
          tenantId: "tenant_test",
          userId: "user_test",
          conversationId: "conv_ambig",
          agentRunId: "run_ambig",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      expect(turns).toBe(1);
      expect(toolsPassed?.length).toBe(0);
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
      expect(events.filter((e) => e.type === "tool_call_start").length).toBe(0);
    });

    it("7. Media failures do not trigger package installation or unrelated shell commands", async () => {
      const mockGateway = new ModelGateway();
      let turns = 0;

      vi.spyOn(mockGateway, "streamChat").mockImplementation(async function* (req) {
        turns++;
        if (turns === 1) {
          yield {
            type: "tool_call_start",
            traceId: req.trace.traceId,
            toolCall: {
              id: "call_img_fail",
              name: "media_image_generate",
              arguments: { prompt: "black obsidian sphere" },
            },
          };
        } else {
          // Model sees failure response and directly reports it to the user without calling shell
          yield {
            type: "text_delta",
            traceId: req.trace.traceId,
            textDelta: "Image generation is temporarily unavailable. Please try again later.",
          };
        }
      });

      const orchestrator = new AgentOrchestrator({ gateway: mockGateway, maxIterations: 5 });
      const request: ChatCompletionRequest = {
        modelId: "auto",
        messages: [{ role: "user", content: "Generate an image of a black obsidian sphere." }],
        stream: true,
        trace: {
          traceId: "test_media_fail",
          tenantId: "tenant_test",
          userId: "user_test",
          conversationId: "conv_media_fail",
          agentRunId: "run_media_fail",
        },
      };

      const events: NormalizedEvent[] = [];
      for await (const event of orchestrator.executeAgentLoop(request)) {
        events.push(event);
      }

      // Completed in 2 turns (turn 1 tool call, turn 2 error reporting)
      expect(turns).toBe(2);
      expect(events.filter((e) => e.type === "terminal_command_start").length).toBe(0);
      const toolStarts = events.filter((e) => e.type === "tool_call_start");
      expect(toolStarts.length).toBe(1);
      expect(toolStarts[0].toolCall?.name).toBe("media_image_generate");
    });
  });
});

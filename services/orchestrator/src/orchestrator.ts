import {
  AgentMemoryManager,
  ChangeReviewManager,
  IntegrationsManager,
  ToolRegistry,
} from "@orbaagent/agent-runtime";
import { ModelGateway } from "@orbaagent/model-gateway";
import type {
  ChatCompletionRequest,
  ChatMessage,
  NormalizedEvent,
  ToolCall,
} from "@orbaagent/shared";

export interface AgentOrchestratorOptions {
  gateway?: ModelGateway;
  registry?: ToolRegistry;
  maxIterations?: number;
  workspacePath?: string;
}

export type OrchestratorLoopState =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_TOOL"
  | "TOOL_RUNNING"
  | "TOOL_RESULT"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "WAITING_FOR_USER";

function indicatesPendingAction(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const lower = text.toLowerCase();
  const transitionPatterns = [
    /now\s+let\s+me/i,
    /let\s+me\s+now/i,
    /next[,\s]+i(?:'ll|\s+will)/i,
    /i(?:'ll|\s+will)\s+now/i,
    /now\s+i(?:'ll|\s+will)/i,
    /let\s+me\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch)/i,
    /let's\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch)/i,
    /proceeding\s+to/i,
    /i\s+am\s+going\s+to/i,
    /now\s+running/i,
    /now\s+checking/i,
    /now\s+executing/i,
    /now\s+testing/i,
    /next\s+step\s*:/i,
    /running\s+the\s+/i,
  ];

  return transitionPatterns.some((pattern) => pattern.test(lower));
}

export class AgentOrchestrator {
  private readonly gateway: ModelGateway;
  private readonly registry: ToolRegistry;
  private readonly maxIterations: number;
  private readonly workspacePath: string;

  constructor(options?: AgentOrchestratorOptions) {
    this.gateway = options?.gateway || new ModelGateway();
    this.registry = options?.registry || new ToolRegistry();
    this.maxIterations = options?.maxIterations || 12;
    this.workspacePath = options?.workspacePath || process.env.ORBA_WORKSPACE_PATH || process.cwd();
  }

  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  async *executeAgentLoop(
    rawRequest: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const trace = rawRequest.trace;
    const userId = trace.userId || "default-user";
    const workspaceId = trace.tenantId || "default-workspace";
    const githubToken = trace.githubToken || process.env.GITHUB_TOKEN;
    const executionSessionId = trace.executionSessionId || `exec_${Date.now()}`;

    // Ensure GitHub token is synchronized in IntegrationsManager and process.env
    if (githubToken) {
      process.env.GITHUB_TOKEN = githubToken;
      const manager = IntegrationsManager.getInstance();
      const current = manager.getIntegrations(userId).find((i) => i.name === "github");
      manager.setIntegrationStatus(userId, {
        name: "github",
        displayName: "GitHub",
        connected: true,
        accountName: current?.accountName || "GitHub User",
        lastSyncedAt: new Date().toISOString(),
        scopes: ["repo", "read:user", "user:email"],
      });
    }

    // Build tool definitions and dynamic capability prompt
    const toolDefinitions = this.registry.getToolDefinitions();
    const capabilityPrompt = this.registry.generateCapabilityPrompt(workspaceId, userId);

    // Retrieve persistent memory of past work & decisions for this workspace
    const memoryManager = AgentMemoryManager.getInstance();
    const memoryPrompt = memoryManager.generateMemoryPrompt(workspaceId, userId);

    const systemContext = memoryPrompt
      ? `${capabilityPrompt}\n\n${memoryPrompt}`
      : capabilityPrompt;

    // Prepare current messages history
    const currentMessages: ChatMessage[] = [...rawRequest.messages];

    // Inject system context into first message or prepend
    const hasSystem = currentMessages.length > 0 && currentMessages[0].role === "system";
    if (!hasSystem) {
      currentMessages.unshift({
        role: "system",
        content: systemContext,
      });
    } else {
      currentMessages[0] = {
        ...currentMessages[0],
        content: `${currentMessages[0].content}\n\n${systemContext}`,
      };
    }

    yield {
      type: "agent_activity",
      traceId: trace.traceId,
      activity: {
        step: "Initializing autonomous session",
        status: "in_progress",
        details: `Tools: ${toolDefinitions.length} registered, State: RUNNING`,
      },
    };

    let iteration = 0;
    let hasExecutedAnyTools = false;
    let isExplicitlyCompleted = false;

    while (iteration < this.maxIterations && !isExplicitlyCompleted) {
      iteration++;

      const stepRequest: ChatCompletionRequest = {
        ...rawRequest,
        messages: currentMessages,
        tools: toolDefinitions,
      };

      const pendingToolCalls: ToolCall[] = [];
      let stepText = "";

      for await (const event of this.gateway.streamChat(stepRequest)) {
        if (event.type === "tool_call_start" && event.toolCall) {
          pendingToolCalls.push(event.toolCall);
          yield event;
        } else if (event.type === "text_delta" && event.textDelta) {
          stepText += event.textDelta;
          yield event;
        } else if (event.type === "done") {
          // Never emit done inside the loop; only emit done when the orchestrator state machine completes
          continue;
        } else {
          yield event;
        }
      }

      // Check if task completed tool was invoked
      const hasTaskCompleteCall = pendingToolCalls.some((c) => c.name === "task_complete");
      if (hasTaskCompleteCall) {
        isExplicitlyCompleted = true;
      }

      // Case 1: No tool calls were produced in this turn
      if (pendingToolCalls.length === 0) {
        // If tools were already executed in earlier iterations and the model emitted transitional text
        // (e.g. "Dependencies installed. Now let me run the type checker and linter."), auto-continue!
        if (hasExecutedAnyTools && indicatesPendingAction(stepText) && iteration < this.maxIterations) {
          currentMessages.push({
            role: "assistant",
            content: stepText,
          });

          currentMessages.push({
            role: "user",
            content:
              "Continue executing the next step in your workflow immediately using your executable tools. Do not stop until all operations and verifications are complete.",
          });

          yield {
            type: "agent_activity",
            traceId: trace.traceId,
            activity: {
              step: "Auto-continuing workflow",
              status: "in_progress",
              details: "Detected uncompleted workflow transition; executing next step autonomously",
            },
          };

          continue;
        }

        // Otherwise, the assistant provided its final conversational answer or report
        break;
      }

      // Record assistant's step message in trajectory
      currentMessages.push({
        role: "assistant",
        content: stepText,
        toolCalls: pendingToolCalls,
      });

      hasExecutedAnyTools = true;

      // Execute each tool call autonomously
      for (const call of pendingToolCalls) {
        yield {
          type: "agent_activity",
          traceId: trace.traceId,
          activity: {
            step: `Executing ${call.name}`,
            status: "in_progress",
            details: JSON.stringify(call.arguments),
          },
        };

        // If shell execution, stream dedicated terminal session events
        if (call.name === "execute_shell") {
          const cmd = String((call.arguments as Record<string, unknown>)?.command || "");
          yield {
            type: "terminal_command_start",
            traceId: trace.traceId,
            executionSessionId,
            command: cmd,
          };
        }

        const result = await this.registry.executeToolCall(call.id, call.name, call.arguments, {
          workspaceDir: this.workspacePath,
          tenantId: trace.tenantId || "default-tenant",
          userId: trace.userId || "default-user",
          agentRunId: trace.agentRunId || "default-run",
          githubToken,
        });

        if (call.name === "execute_shell") {
          if (result.output) {
            yield {
              type: "terminal_stdout",
              traceId: trace.traceId,
              executionSessionId,
              textDelta: result.output,
            };
          }
          if (result.error) {
            yield {
              type: "terminal_stderr",
              traceId: trace.traceId,
              executionSessionId,
              textDelta: result.error,
            };
          }
          yield {
            type: "terminal_exit",
            traceId: trace.traceId,
            executionSessionId,
            exitCode: result.success ? 0 : 1,
          };
        }

        yield {
          type: "tool_call_result",
          traceId: trace.traceId,
          toolResult: result,
        };

        yield {
          type: "agent_activity",
          traceId: trace.traceId,
          activity: {
            step: `Completed ${call.name}`,
            status: result.success ? "completed" : "failed",
            details: result.output ? result.output.slice(0, 200) : result.error,
          },
        };

        // Append tool result message
        currentMessages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: result.output || result.error || (result.success ? "Success" : "Failed"),
        });

        if (call.name === "task_complete" && result.success) {
          isExplicitlyCompleted = true;
        }
      }

      if (isExplicitlyCompleted) {
        break;
      }
    }

    // Capture and yield any filesystem changes made by this agent run
    try {
      const changeManager = ChangeReviewManager.getInstance();
      const changes = await changeManager.detectChanges(
        trace.agentRunId,
        this.workspacePath,
        workspaceId,
      );
      if (changes.length > 0) {
        yield {
          type: "file_changes_detected",
          traceId: trace.traceId,
          changes,
        };
      }
    } catch (e) {
      console.warn("Failed to detect agent changes:", e);
    }

    // Persist memory of completed work for subsequent agent runs
    if (hasExecutedAnyTools || isExplicitlyCompleted) {
      const summaryMsg = currentMessages[currentMessages.length - 1]?.content || "";
      if (summaryMsg.length > 20) {
        memoryManager.addMemory(
          workspaceId,
          userId,
          "past_work",
          `Completed run (${trace.agentRunId}): ${summaryMsg.slice(0, 240)}`,
        );
      }
    }

    yield {
      type: "agent_activity",
      traceId: trace.traceId,
      activity: {
        step: isExplicitlyCompleted ? "Objective Completed" : "Response Finished",
        status: "completed",
        details: `Finished in ${iteration} iteration(s)`,
      },
    };

    // Emit final done event
    yield {
      type: "done",
      traceId: trace.traceId,
      finishReason: "stop",
    };
  }
}

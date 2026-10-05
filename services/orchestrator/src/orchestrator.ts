import { ToolRegistry } from "@orbaagent/agent-runtime";
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
  | "TOOL_RUNNING"
  | "TOOL_RESULT"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED";

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
    this.maxIterations = options?.maxIterations || 10;
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

    // Build tool definitions and capability prompt
    const toolDefinitions = this.registry.getToolDefinitions();
    const capabilityPrompt = this.registry.generateCapabilityPrompt(workspaceId, userId);

    // Prepare current messages history
    const currentMessages: ChatMessage[] = [...rawRequest.messages];

    // Inject capability prompt into first message or prepend
    const hasSystem = currentMessages.length > 0 && currentMessages[0].role === "system";
    if (!hasSystem) {
      currentMessages.unshift({
        role: "system",
        content: capabilityPrompt,
      });
    } else {
      currentMessages[0] = {
        ...currentMessages[0],
        content: `${currentMessages[0].content}\n\n${capabilityPrompt}`,
      };
    }

    yield {
      type: "agent_activity",
      traceId: trace.traceId,
      activity: {
        step: "Initializing autonomous session",
        status: "in_progress",
        details: `Tools: ${toolDefinitions.length} registered`,
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
          // Never emit done inside the loop; only emit done when the orchestrator finishes
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

      // Case 1: No tool calls were produced
      if (pendingToolCalls.length === 0) {
        // If tools were already executed in earlier iterations and the model emitted transitional text
        // like "Dependencies installed. Now let me run the type checker and linter.", auto-continue!
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

        const result = await this.registry.executeToolCall(call.id, call.name, call.arguments, {
          workspaceDir: this.workspacePath,
          tenantId: trace.tenantId || "default-tenant",
          userId: trace.userId || "default-user",
          agentRunId: trace.agentRunId || "default-run",
          githubToken: process.env.GITHUB_TOKEN,
        });

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

      // Continue to next iteration: the model will observe the tool results and either call another tool or give the final answer!
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

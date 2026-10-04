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

export class AgentOrchestrator {
  private readonly gateway: ModelGateway;
  private readonly registry: ToolRegistry;
  private readonly maxIterations: number;
  private readonly workspacePath: string;

  constructor(options?: AgentOrchestratorOptions) {
    this.gateway = options?.gateway || new ModelGateway();
    this.registry = options?.registry || new ToolRegistry();
    this.maxIterations = options?.maxIterations || 8;
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

    let iteration = 0;
    while (iteration < this.maxIterations) {
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
          // If there are tool calls to execute, don't yield final done yet
          if (pendingToolCalls.length === 0) {
            yield event;
          }
        } else {
          yield event;
        }
      }

      // If no tool calls were requested, the agent is done!
      if (pendingToolCalls.length === 0) {
        break;
      }

      // Record assistant's step message in trajectory
      currentMessages.push({
        role: "assistant",
        content: stepText,
        toolCalls: pendingToolCalls,
      });

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
      }

      // Continue to next iteration: the model will observe the tool results and either call another tool or give the final answer!
    }

    // Emit final done event
    yield {
      type: "done",
      traceId: trace.traceId,
      finishReason: "stop",
    };
  }
}

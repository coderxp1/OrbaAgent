import * as path from "node:path";
import {
  AgentMemoryManager,
  CapabilityManager,
  ChangeReviewManager,
  IntegrationsManager,
  TaskPlanManager,
  ToolRegistry,
  ToolRouter,
  parseDocument,
} from "@orbaagent/agent-runtime";
import { ModelGateway } from "@orbaagent/model-gateway";
import type {
  ChatCompletionRequest,
  ChatMessage,
  NormalizedEvent,
  ToolCall,
} from "@orbaagent/shared";
import { routeUserIntent } from "./intentRouter.js";

export interface AgentOrchestratorOptions {
  gateway?: ModelGateway;
  registry?: ToolRegistry;
  router?: ToolRouter;
  maxIterations?: number;
  workspacePath?: string;
  autoApprove?: boolean;
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
    /now\s+let\s+me\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit|repair|fix)/i,
    /let\s+me\s+now\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit|repair|fix)/i,
    /next[,\s]+i(?:'ll|\s+will)\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit|repair|fix)/i,
    /i(?:'ll|\s+will)\s+now\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit|repair|fix)/i,
    /now\s+i(?:'ll|\s+will)\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit|repair|fix)/i,
    /let\s+me\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch)/i,
    /let's\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch)/i,
    /proceeding\s+to\s+(?:run|check|inspect|execute|install|verify|build|test|clone|fetch|write|edit)/i,
    /now\s+running/i,
    /now\s+checking/i,
    /now\s+executing/i,
    /now\s+testing/i,
    /next\s+step\s*:\s*(?:run|check|inspect|execute|install|verify|build|test)/i,
    /running\s+the\s+/i,
  ];

  return transitionPatterns.some((pattern) => pattern.test(lower));
}

export class AgentOrchestrator {
  private readonly gateway: ModelGateway;
  private readonly registry: ToolRegistry;
  private readonly router: ToolRouter;
  private readonly maxIterations: number;
  private readonly workspacePath: string;
  private readonly autoApprove: boolean;

  constructor(options?: AgentOrchestratorOptions) {
    this.gateway = options?.gateway || new ModelGateway();
    this.registry = options?.registry || new ToolRegistry();
    this.router = options?.router || new ToolRouter({ registry: this.registry });
    this.maxIterations = options?.maxIterations || 12;
    this.workspacePath = options?.workspacePath || process.env.ORBA_WORKSPACE_PATH || process.cwd();
    this.autoApprove = options?.autoApprove ?? false;
  }

  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  getToolRouter(): ToolRouter {
    return this.router;
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

    // Natural-language intent routing: detect user intent and determine capability mode
    const intentResult = routeUserIntent(rawRequest.messages, this.registry);

    const isConversational =
      intentResult.intent === "conversation" || intentResult.intent === "ambiguous";
    const isMedia = intentResult.intent === "media_image" || intentResult.intent === "media_video";
    const isArtifact = intentResult.intent === "artifact_management";
    const isTechnical =
      intentResult.intent === "software_engineering" ||
      intentResult.intent === "system_operation" ||
      intentResult.intent === "general_coding";

    // Initialize dynamic tool state based strictly on detected intent:
    if (isConversational) {
      // In conversation mode, no execution tools are active.
      // Distinguishes having tools available from actually invoking them.
      this.registry.clearActiveTools();
    } else if (isMedia) {
      // In media mode, only the target media tool is active.
      // Strictly isolates media generation from coding, shell execution, or package tools.
      this.registry.clearActiveTools();
      if (intentResult.toolsToActivate.length > 0) {
        this.registry.activateTools(intentResult.toolsToActivate);
      }
    } else if (isArtifact) {
      // In artifact mode, only artifact discovery and inspection tools are active.
      this.registry.clearActiveTools();
      this.registry.activateTools(["artifact_list", "artifact_read"]);
    } else {
      // Software engineering / system operations: initialize core tools and any explicit tools
      this.registry.resetActiveToolsToCore();
      if (intentResult.toolsToActivate.length > 0) {
        this.registry.activateTools(intentResult.toolsToActivate);
      }
    }

    const activeToolDefinitions = this.registry.getActiveToolDefinitions();
    const totalToolsCount = this.registry.getAllToolDefinitions().length;
    const initialToolsCount = activeToolDefinitions.length;
    const tokenSavingsPct = (
      ((totalToolsCount - initialToolsCount) / totalToolsCount) *
      100
    ).toFixed(1);

    // Refresh live capability health (e.g. GPU media worker) with short cache
    await CapabilityManager.getInstance()
      .checkMediaWorkerHealth()
      .catch(() => false);

    // Build dynamic capability prompt and persistent memory context
    const capabilityPrompt = this.registry.generateCapabilityPrompt(workspaceId, userId);
    const memoryManager = AgentMemoryManager.getInstance();
    const memoryPrompt = memoryManager.generateMemoryPrompt(workspaceId, userId);

    const planManager = TaskPlanManager.getInstance();
    const existingPlan = isTechnical ? planManager.getActivePlan(workspaceId) : null;
    let planContext = "";
    if (existingPlan && existingPlan.status !== "completed") {
      const pendingSteps = existingPlan.steps.filter(
        (s) => s.status !== "completed" && s.status !== "skipped",
      );
      planContext = `\n\n## Resumed Active Plan (${existingPlan.planId})\nGoal: ${existingPlan.goal}\nRemaining Steps:\n${pendingSteps
        .map((s) => `- ${s.id}: ${s.title} [${s.status}]`)
        .join(
          "\n",
        )}\nResume execution from the next pending step. Do not repeat already completed steps.\n`;
    }

    const conversationFirstBaseline = `
## Conversation-First Baseline Policy
OrbaAgent is a professional conversational AI assistant first.
- Having tools available in the system does NOT mean you should invoke them.
- For normal conversation, greetings, questions, explanations, feedback, ideas, or conceptual discussions, respond directly and naturally in well-structured conversational text using your language model capabilities.
- NEVER invoke tools, create task plans, search tools, or run shell commands when answering directly is sufficient.
- Ambiguous requests must NEVER trigger speculative tool execution or terminal commands. Clarify with the user instead.
- Exception for Media Generation: When a user directly asks to generate a video or image (in Spanish, English, German, French, etc.), do NOT trap them in questionnaires or preference surveys about duration, style, camera, or orientation. Infer sensible defaults and execute the media generation tool immediately on the first turn.
- Tools must ONLY be invoked when the user's specific request genuinely requires media generation, workspace file changes, package management, or system operations.

## Photorealistic Humans, Commercial Models & Image Editing Policy
- OrbaAgent powers commercial advertising, fashion, lifestyle, and business media workflows.
- Generating fictional photorealistic adult humans, fashion models, commercial lifestyle scenes, and realistic characters is 100% PERMITTED and an essential core capability.
- Distinguish between:
  1. Fictional photorealistic adult humans/models: ALWAYS ALLOW and execute 'media_image_generate' immediately. Describe realistic human features (natural skin texture, authentic pores, realistic hair, studio/natural lighting).
  2. Editing user-uploaded photos/images: ALWAYS ALLOW ordinary permitted edits (e.g., changing clothing, background, lighting, enhancing, or placing products into commercial scenes).
  3. Identifiable real public/private figures or non-consensual deepfakes: Apply safety protections; do not impersonate or depict specific real living individuals without consent.
  4. Disallowed content: Retain standard safety protections (no CSAM, hate, violence, etc.).
- The phrase "real human", "real person", "photorealistic woman/man", or "actual person" indicates a request for photographic realism (as opposed to a 3D avatar, cartoon, or CGI rendering). It must NEVER trigger a refusal. Execute 'media_image_generate' immediately with photographic prompt details.
`;

    const autonomousPolicy = `
## Autonomous Coding & Verification Policy
1. When assigned a technical goal or bug repair, use 'task_plan' to decompose the goal into structured, ordered steps with dependencies and acceptance criteria.
2. Search and activate relevant tools using 'tools_search' (e.g. read_file, write_file, edit_file, execute_shell, test_runner).
3. Execute real changes in the workspace and track step progression with 'task_step'.
4. Before concluding, verify the work by running tests or checks ('test_runner', 'lint_typecheck', or 'execute_shell').
5. If verification fails, diagnose the error, modify the files to fix the issue, and rerun verification.
6. Call 'task_complete' only after all steps are completed and verification has confirmed the work.
`;

    let systemContext = memoryPrompt ? `${capabilityPrompt}\n\n${memoryPrompt}` : capabilityPrompt;
    systemContext += `\n\n${conversationFirstBaseline}`;

    if (isTechnical) {
      systemContext += `${autonomousPolicy}${planContext}`;
    }

    if (intentResult.systemGuidance) {
      systemContext += `\n\n${intentResult.systemGuidance}`;
    }

    // Pre-extract document contents for immediate understanding
    if (rawRequest.attachments && rawRequest.attachments.length > 0) {
      const docExcerpts: string[] = [];
      const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
      for (const att of rawRequest.attachments) {
        const isDoc = /\.(pdf|docx|txt|csv|tsv|json|md|xml|yaml|yml|ts|js|py|html|css|zip)$/i.test(
          att.name || "",
        );
        if (isDoc && att.artifactId) {
          try {
            const decoded = JSON.parse(Buffer.from(att.artifactId, "base64url").toString("utf-8"));
            const filePath = path.join(baseDir, decoded.w, decoded.b, decoded.p);
            const parsed = await parseDocument(filePath, decoded.p, 25000);
            docExcerpts.push(
              `[Attached Document: ${att.name || decoded.p} (${parsed.kind})]\n${parsed.text.slice(0, 10000)}${parsed.truncated ? "\n...(content truncated)" : ""}`,
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            docExcerpts.push(`[Attached Document: ${att.name}]: Error reading document: ${msg}`);
          }
        }
      }
      if (docExcerpts.length > 0) {
        systemContext += `\n\n## Attached User Documents\n${docExcerpts.join("\n\n")}`;
      }
    }

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

    if (intentResult.toolsToActivate.length > 0) {
      yield {
        type: "agent_activity",
        traceId: trace.traceId,
        activity: {
          step: `Intent routing: activated ${intentResult.toolsToActivate.join(", ")}`,
          status: "in_progress",
          details: `Detected ${intentResult.intent} intent with ${(intentResult.confidence * 100).toFixed(0)}% confidence`,
        },
      };
    }

    yield {
      type: "agent_activity",
      traceId: trace.traceId,
      activity: {
        step: "Initializing dynamic tool discovery runtime",
        status: "in_progress",
        details: `Core tools: ${initialToolsCount}/${totalToolsCount} active (${tokenSavingsPct}% context token savings), State: RUNNING`,
      },
    };

    let iteration = 0;
    let hasExecutedAnyTools = false;
    let isExplicitlyCompleted = false;

    while (iteration < this.maxIterations && !isExplicitlyCompleted) {
      iteration++;

      // Dynamically inject only currently active tools into the model context
      const currentTools = this.registry.getActiveToolDefinitions();

      const stepRequest: ChatCompletionRequest = {
        ...rawRequest,
        messages: currentMessages,
        tools: currentTools,
      };

      const pendingToolCalls: ToolCall[] = [];
      let stepText = "";
      let streamErrorEvent: any = null;

      for await (const event of this.gateway.streamChat(stepRequest)) {
        if (event.type === "tool_call_start" && event.toolCall) {
          pendingToolCalls.push(event.toolCall);
          yield event;
        } else if (event.type === "text_delta" && event.textDelta) {
          stepText += event.textDelta;
          yield event;
        } else if (event.type === "error") {
          streamErrorEvent = event;
          // If media generation intent was detected, do not immediately yield the fatal error to the user;
          // give the dedicated GPU media pipeline a chance to execute autonomously
          if (intentResult.intent !== "media_video" && intentResult.intent !== "media_image") {
            yield event;
          }
        } else if (event.type === "done") {
        } else {
          yield event;
        }
      }

      // Resilient Media Fallback: If text model gateway failed or rate-limited, but intent is explicit media generation,
      // dispatch directly to the media tool with extracted parameters
      if (
        (streamErrorEvent || pendingToolCalls.length === 0) &&
        (intentResult.intent === "media_video" || intentResult.intent === "media_image") &&
        iteration === 1 &&
        !hasExecutedAnyTools
      ) {
        const isVideo = intentResult.intent === "media_video";
        const toolName = isVideo ? "media_video_generate" : "media_image_generate";

        // Find attached image URL if available
        let attachedImageUrl = (intentResult.extractedParameters as any)?.image_url;
        if (!attachedImageUrl && rawRequest.attachments && rawRequest.attachments.length > 0) {
          const imgAtt = rawRequest.attachments.find((a) =>
            a.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || ""),
          );
          if (imgAtt) {
            attachedImageUrl =
              (imgAtt as any).url ||
              (imgAtt.artifactId
                ? `/api/artifacts/default-tenant/${imgAtt.artifactId}`
                : undefined);
          }
        }

        const rawLastMsg = rawRequest.messages[rawRequest.messages.length - 1]?.content;
        const fallbackPrompt =
          (intentResult.extractedParameters as any)?.prompt ||
          (typeof rawLastMsg === "string"
            ? rawLastMsg
            : Array.isArray(rawLastMsg)
              ? (rawLastMsg as any[]).find((p) => p.type === "text")?.text || "Cinematic video"
              : "Cinematic video");

        const fallbackArgs = isVideo
          ? {
              prompt: fallbackPrompt,
              width: intentResult.extractedParameters?.width || 720,
              height: intentResult.extractedParameters?.height || 1280,
              duration_seconds: intentResult.extractedParameters?.duration_seconds || 3,
              fps: intentResult.extractedParameters?.fps || 16,
              ...(attachedImageUrl ? { image_url: attachedImageUrl } : {}),
            }
          : {
              prompt: fallbackPrompt,
              width: intentResult.extractedParameters?.width || 1024,
              height: intentResult.extractedParameters?.height || 1024,
              steps: 4,
              ...(attachedImageUrl ? { image_url: attachedImageUrl } : {}),
            };

        pendingToolCalls.push({
          id: `direct_media_${Date.now()}`,
          name: toolName,
          arguments: fallbackArgs,
        });

        yield {
          type: "agent_activity",
          traceId: trace.traceId,
          activity: {
            step: `Executing ${isVideo ? "video" : "image"} pipeline`,
            status: "in_progress",
            details: `Autonomous routing: dispatching to high-performance media engine`,
          },
        };
      } else if (streamErrorEvent && pendingToolCalls.length === 0) {
        yield streamErrorEvent;
        break;
      }

      // Case 1: No tool calls were produced in this turn
      if (pendingToolCalls.length === 0) {
        const activePlan = isTechnical ? planManager.getActivePlan(workspaceId) : null;
        const planEval = activePlan ? planManager.evaluatePlanCompletion(activePlan.planId) : null;

        if (isTechnical && planEval && !planEval.canComplete && iteration < this.maxIterations) {
          const nextStep = planManager.getNextExecutableStep(activePlan!.planId);
          currentMessages.push({
            role: "assistant",
            content: stepText,
          });

          const continuePrompt = nextStep
            ? `Your active plan '${activePlan!.planId}' is in progress (${planEval.completedSteps}/${planEval.totalSteps} steps completed). Proceed immediately with step '${nextStep.id}: ${nextStep.title}'. Execute the required tools to fulfill its criteria and update the step.`
            : `Your active plan '${activePlan!.planId}' has pending or failed steps. Diagnose any failures, repair them, run tests, and continue until all acceptance criteria are verified.`;

          currentMessages.push({
            role: "user",
            content: continuePrompt,
          });

          yield {
            type: "agent_activity",
            traceId: trace.traceId,
            activity: {
              step: "Auto-continuing planned workflow",
              status: "in_progress",
              details: `Executing step in plan ${activePlan!.planId} (${planEval.completedSteps}/${planEval.totalSteps} completed)`,
            },
          };

          continue;
        }

        if (
          isTechnical &&
          hasExecutedAnyTools &&
          indicatesPendingAction(stepText) &&
          iteration < this.maxIterations
        ) {
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

        // Final response delivered
        break;
      }

      // Record assistant's step message in trajectory
      currentMessages.push({
        role: "assistant",
        content: stepText,
        toolCalls: pendingToolCalls,
      });

      hasExecutedAnyTools = true;

      // Execute each tool call autonomously with permission and secret isolation
      for (const call of pendingToolCalls) {
        const toolMeta = this.registry.getToolMetadata(call.name);
        const riskTier = toolMeta?.riskTier || "TIER_0_READ";

        yield {
          type: "permission_requested",
          traceId: trace.traceId,
          permissionDetails: {
            toolName: call.name,
            riskTier,
            action: call.name,
          },
        };

        if (call.name === "media_video_generate") {
          yield {
            type: "agent_activity",
            traceId: trace.traceId,
            activity: {
              step: "Creating your video…",
              status: "in_progress",
              details: "Rendering cinematic motion frames…",
            },
          };
        } else if (call.name === "media_image_generate") {
          yield {
            type: "agent_activity",
            traceId: trace.traceId,
            activity: {
              step: "Creating your image…",
              status: "in_progress",
              details: "Rendering high-resolution artwork…",
            },
          };
        } else {
          yield {
            type: "agent_activity",
            traceId: trace.traceId,
            activity: {
              step: `Executing ${call.name}`,
              status: "in_progress",
              details: JSON.stringify(call.arguments),
            },
          };
        }

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

        const { result, auditEvent } = await this.router.routeAndExecute(
          call.id,
          call.name,
          call.arguments,
          {
            workspaceDir: this.workspacePath,
            tenantId: trace.tenantId || "default-tenant",
            userId: trace.userId || "default-user",
            agentRunId: trace.agentRunId || "default-run",
            githubToken,
            traceId: trace.traceId,
            isPreApproved: Boolean(this.autoApprove || (trace as any)?.isPreApproved),
            // Surface structured attachments to tools to enable artifact_list/read without relying on URLs in text
            attachments: (rawRequest as any).attachments || [],
          },
        );

        if (auditEvent?.approved) {
          yield {
            type: "permission_granted",
            traceId: trace.traceId,
            permissionDetails: {
              toolName: call.name,
              riskTier: auditEvent.riskTier,
              action: call.name,
            },
          };
        } else {
          yield {
            type: "permission_denied",
            traceId: trace.traceId,
            permissionDetails: {
              toolName: call.name,
              riskTier: auditEvent?.riskTier || riskTier,
              action: call.name,
              reason: auditEvent?.reason || result.error,
            },
          };
        }

        if (auditEvent) {
          yield {
            type: "audit_logged",
            traceId: trace.traceId,
            auditEvent,
          };
        }

        if (
          call.name === "tools_search" &&
          result.success &&
          (result.metadata as any)?.discoveredTools
        ) {
          yield {
            type: "tools_discovered",
            traceId: trace.traceId,
            discoveredTools: (result.metadata as any).discoveredTools as string[],
          };
        }

        if (call.name === "task_plan" && result.success && (result.metadata as any)?.plan) {
          yield {
            type: "task_plan_updated",
            traceId: trace.traceId,
            taskPlan: (result.metadata as any).plan,
          };
        }

        if (call.name === "task_step" && result.success) {
          if ((result.metadata as any)?.step) {
            yield {
              type: "task_step_updated",
              traceId: trace.traceId,
              taskStep: (result.metadata as any).step,
            };
          }
          const planId = (result.metadata as any)?.planId;
          if (planId) {
            const p = planManager.getPlan(planId);
            if (p) {
              yield {
                type: "task_plan_updated",
                traceId: trace.traceId,
                taskPlan: p,
              };
            }
          }
        }

        if (
          call.name === "test_runner" ||
          call.name === "lint_typecheck" ||
          call.name === "media_image_generate" ||
          call.name === "media_video_generate"
        ) {
          yield {
            type: "task_verification",
            traceId: trace.traceId,
            verification: {
              checkName: call.name,
              passed: result.success && (result.metadata as any)?.delivered !== false,
              evidence: result.output || result.error || "",
            },
          };
        }

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

        let completionStep = `Completed ${call.name}`;
        let completionDetails = result.output ? result.output.slice(0, 200) : result.error;
        if (call.name === "media_video_generate") {
          completionStep = result.success ? "Your video is ready" : "Video generation failed";
          completionDetails = result.success
            ? "Ready for playback"
            : result.error || "Generation could not be completed";
        } else if (call.name === "media_image_generate") {
          completionStep = result.success ? "Your image is ready" : "Image generation failed";
          completionDetails = result.success
            ? "Ready for viewing"
            : result.error || "Generation could not be completed";
        }

        yield {
          type: "agent_activity",
          traceId: trace.traceId,
          activity: {
            step: completionStep,
            status: result.success ? "completed" : "failed",
            details: completionDetails,
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

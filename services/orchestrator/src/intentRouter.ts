import type { ToolRegistry } from "@orbaagent/agent-runtime";
import type { ChatMessage } from "@orbaagent/shared";

export type UserIntent =
  | "conversation"
  | "media_image"
  | "media_video"
  | "artifact_management"
  | "software_engineering"
  | "system_operation"
  | "ambiguous"
  | "general_coding"
  | "unknown";

export interface IntentRoutingResult {
  intent: UserIntent;
  confidence: number;
  toolsToActivate: string[];
  extractedParameters?: Record<string, unknown>;
  systemGuidance?: string;
}

/**
 * Words to numbers mapping for duration extraction (e.g. "two-second" -> 2)
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Parses duration in seconds from user prompt text.
 * Handles patterns like "two-second", "2s", "2 seconds", "4-second clip", etc.
 */
export function extractVideoDurationSeconds(text: string): number | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  // Pattern 1: word-second (e.g. "two-second", "four seconds")
  const wordMatch = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)[-\s]+seconds?\b/,
  );
  if (wordMatch?.[1] && NUMBER_WORDS[wordMatch[1]]) {
    return NUMBER_WORDS[wordMatch[1]];
  }

  // Pattern 2: digit second(s) or Xs (e.g. "2 seconds", "2-second", "2s", "4s")
  const digitMatch = lower.match(/\b(\d+)(?:[-\s]*seconds?|s)\b/);
  if (digitMatch?.[1]) {
    const val = Number.parseInt(digitMatch[1], 10);
    if (!Number.isNaN(val) && val > 0 && val <= 30) {
      return val;
    }
  }

  return undefined;
}

/**
 * Extracts resolution dimensions (width x height) if specified in text (e.g. "480x480", "768x768", "1024x1024").
 */
export function extractDimensions(text: string): { width: number; height: number } | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(\d{3,4})\s*[xX*×]\s*(\d{3,4})\b/);
  if (match?.[1] && match[2]) {
    const w = Number.parseInt(match[1], 10);
    const h = Number.parseInt(match[2], 10);
    if (w >= 256 && w <= 2048 && h >= 256 && h <= 2048) {
      return { width: w, height: h };
    }
  }
  return undefined;
}

/**
 * Scans previous conversation turns to detect if the assistant proposed a pending
 * media prompt or plan that the user is now confirming.
 */
export function findPendingMediaProposal(messages: ChatMessage[]): {
  type: "video" | "image";
  prompt: string;
  duration?: number;
  width?: number;
  height?: number;
} | null {
  if (!messages || messages.length < 2) return null;

  // Find the most recent assistant message prior to the latest user message
  let lastAssistantIndex = -1;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) return null;

  const assistantMsg = messages[lastAssistantIndex];
  const asstText =
    typeof assistantMsg.content === "string"
      ? assistantMsg.content
      : Array.isArray(assistantMsg.content)
        ? assistantMsg.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
        : "";

  if (!asstText) return null;

  // Check if the assistant message proposed a prompt or generation task
  const hasProposalCue =
    /generation-ready prompt|suggested prompt|ready prompt|prompt is ready|can generate (?:ai )?(?:video|image)|prompt:|template:|use a template/i.test(
      asstText,
    ) ||
    /(?:^|\n)>\s*\*\*/.test(asstText) ||
    /(?:^|\n)>\s*[A-Z]/.test(asstText) ||
    /\b(?:wan2\.1|flux(?:\.1)?)\b/i.test(asstText);

  if (!hasProposalCue) return null;

  // Check if it's video or image
  const isVideo =
    /\b(?:wan2\.1|video|t2v|fps|seconds?|motion|tracking|camera|cinematic scene)\b/i.test(asstText);

  // 1. Try to extract from a blockquote: > ...
  let extractedPrompt = "";
  const blockquoteMatches = asstText.match(/(?:^|\n)>\s*(.*?)(?=\n\n|\n(?=[^>])|$)/gs);
  if (blockquoteMatches && blockquoteMatches.length > 0) {
    extractedPrompt = blockquoteMatches
      .map((b) => b.replace(/(?:^|\n)>\s*/g, " ").trim())
      .join(" ")
      .replace(/^\*\*[^*]+\*\*\s*/, "") // Remove bold header like **Cinematic thriller scene, nighttime.**
      .trim();
  }

  // 2. If blockquote wasn't found or was too short, check for quoted prompt: "..." or “...”
  if (!extractedPrompt || extractedPrompt.length < 15) {
    const quotedMatches = asstText.match(/["“]([^"”]{20,})["”]/);
    if (quotedMatches && quotedMatches[1]) {
      extractedPrompt = quotedMatches[1].trim();
    }
  }

  // 3. Fallback: look at the user request immediately prior to that assistant turn
  if (!extractedPrompt || extractedPrompt.length < 15) {
    for (let i = lastAssistantIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        const prevUserText =
          typeof messages[i].content === "string"
            ? (messages[i].content as string)
            : "";
        if (prevUserText.trim().length > 10) {
          extractedPrompt = prevUserText.trim();
          break;
        }
      }
    }
  }

  if (!extractedPrompt) return null;

  const duration = extractVideoDurationSeconds(extractedPrompt) || (isVideo ? 2 : undefined);
  const dims = extractDimensions(extractedPrompt) || (isVideo ? { width: 480, height: 480 } : { width: 512, height: 512 });

  return {
    type: isVideo ? "video" : "image",
    prompt: extractedPrompt,
    duration,
    width: dims.width,
    height: dims.height,
  };
}

/**
 * Analyzes conversation messages to detect user intent and automatically
 * activates matching non-core tools from the capability registry.
 */
export function routeUserIntent(
  messages: ChatMessage[],
  registry?: ToolRegistry,
): IntentRoutingResult {
  // Inspect latest user message
  const userMessages = messages.filter((m) => m.role === "user");
  const latestMessage = userMessages[userMessages.length - 1];
  const content =
    typeof latestMessage?.content === "string"
      ? latestMessage.content
      : Array.isArray(latestMessage?.content)
        ? latestMessage.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
        : "";

  if (!content.trim()) {
    return {
      intent: "unknown",
      confidence: 0,
      toolsToActivate: [],
    };
  }

  const lower = content.toLowerCase().trim();

  // 0. Multi-Turn Follow-Up / Task Confirmation Check (e.g. "go", "yes", "use that prompt", "ok, use that suggested promtp")
  // If the user confirms a pending media generation task, resume and execute with the proposed prompt
  const isConfirmation =
    /^(?:ok|okay|yes|sure|go|proceed|do it|generate it|make it|render it|create it|start it|run it|use that(?:\s+suggested)?\s+prom?p?t?|use this(?:\s+suggested)?\s+prom?p?t?|sounds good|looks good)(?:[,\s.!?-]+(?:go|proceed|generate(?:\s+it)?|do\s+it|use\s+that(?:\s+suggested)?\s+prom?p?t?|please|ahead))*$/i.test(
      lower,
    ) ||
    /\b(?:use\s+that(?:\s+suggested)?\s+prom?p?t?|use\s+this(?:\s+suggested)?\s+prom?p?t?|yes\s*,?\s*(?:please\s*,?\s*)?(?:generate|create|make|do\s+it|go)|ok\s*,?\s*(?:go|generate|create|make\s+it|use\s+that)|go\s+ahead(?:\s+and\s+generate)?)\b/i.test(
      lower,
    );

  if (isConfirmation) {
    const pendingMedia = findPendingMediaProposal(messages);
    if (pendingMedia) {
      const isVideo = pendingMedia.type === "video";
      const toolToActivate = isVideo ? "media_video_generate" : "media_image_generate";
      if (registry) {
        registry.activateTools([toolToActivate]);
      }

      return {
        intent: isVideo ? "media_video" : "media_image",
        confidence: 0.98,
        toolsToActivate: [toolToActivate],
        extractedParameters: {
          prompt: pendingMedia.prompt,
          duration_seconds: pendingMedia.duration,
          width: pendingMedia.width,
          height: pendingMedia.height,
          fps: 16,
          model: isVideo ? "wan2.1-t2v-1.3b" : "black-forest-labs/FLUX.1-schnell",
        },
        systemGuidance: `[Intent Router: Resumed Pending Media Generation]
The user approved the pending ${pendingMedia.type} generation task ("${content}").
Tool '${toolToActivate}' is ACTIVE and ready to execute.
EXECUTE '${toolToActivate}' IMMEDIATELY with:
- prompt: ${JSON.stringify(pendingMedia.prompt)}
${isVideo ? `- duration_seconds: ${pendingMedia.duration || 2}\n- width: ${pendingMedia.width || 480}\n- height: ${pendingMedia.height || 480}\n- fps: 16` : `- width: ${pendingMedia.width || 512}\n- height: ${pendingMedia.height || 512}\n- steps: 4`}
DO NOT ask for further confirmation or explain how to run it. Call '${toolToActivate}' directly now.`,
      };
    }
  }

  // 1. Artifact Review & Inspection Intent (e.g. "list generated media", "what artifacts have been generated?")
  const isArtifactQuery =
    /\b(?:list|show|view|inspect|display|check|get|find)\s+(?:all\s+|me\s+|the\s+)*(?:generated\s+)?(?:artifacts|media|files|images|videos|uploads|attachments)\b/i.test(
      lower,
    ) ||
    /\bwhat\s+(?:artifacts|media|images|videos|files)\s+(?:did\s+you\s+generate|have\s+been\s+generated|were\s+generated|are\s+available|do\s+we\s+have)\b/i.test(
      lower,
    ) ||
    /\b(?:list|show)\s+(?:all\s+)?artifacts\b/i.test(lower);

  if (isArtifactQuery) {
    const toolsToActivate = ["artifact_list", "artifact_read"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }
    return {
      intent: "artifact_management",
      confidence: 0.95,
      toolsToActivate,
      systemGuidance: `[Intent Router: Detected Artifact Management Request]
The user wants to list or inspect generated media or uploaded artifacts. Tools 'artifact_list' and 'artifact_read' are active.
Use 'artifact_list' to discover available workspace artifacts and display them with their URLs.`,
    };
  }

  // 2. Software Engineering Exclusions: Requests discussing media as code/components
  const isSoftwareVideoTask =
    /\bvideo\s+(?:player|element|tag|component|view|stream|streaming|upload(?:er|ing)?|feed|controller|card|modal|dialog|container|pipeline|service|backend|api|endpoint|route)\b/i.test(
      lower,
    );
  const isSoftwareImageTask =
    /\bimage\s+(?:upload(?:er|ing)?|component|carousel|gallery|grid|feed|picker|cropper|compression|optimizer|converter|resizer|pipeline|service|backend|api|endpoint|route|tag|element)\b/i.test(
      lower,
    );
  const isPlanningOrDiagramTask =
    /\b(?:sketch|draw)\s+(?:out|up)\b/i.test(lower) ||
    /\b(?:draw|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:architecture|diagram|flowchart|schema|system|pipeline|wireframe|mockup|solution|plan|roadmap|steps?)\b/i.test(
      lower,
    );

  // 2b. Media Capability Inquiry (e.g. "Can you generate images?", "Can you generate videos?", "Are you able to create videos?")
  // Questions inquiring about capability must be answered conversationally with the live capability manifest
  // and must NEVER automatically trigger a generation job or shell workflow.
  const isMediaCapabilityQuery =
    /\b(?:can\s+you|are\s+you\s+able\s+to|do\s+you\s+support|is\s+it\s+possible\s+to|how\s+do\s+you|what\s+kind\s+of)\s+(?:generate|create|make|produce|render|do)\s+(?:any\s+)?(?:images?|pictures?|photos?|videos?|animations?|media)\b/i.test(
      lower,
    ) ||
    /\b(?:can\s+you|do\s+you)\s+(?:do|support)\s+(?:image|video|media)\s+generation\b/i.test(
      lower,
    ) ||
    /^(?:can\s+you\s+(?:generate|create|make)\s+(?:images?|videos?|pictures?|media)\??)$/i.test(
      lower,
    );

  if (isMediaCapabilityQuery) {
    return {
      intent: "conversation",
      confidence: 0.95,
      toolsToActivate: [],
      systemGuidance: `[Intent Router: Detected Media Capability Inquiry]
The user is asking about your image or video generation capabilities.
Derive your response truthfully and conversationally from the LIVE RUNTIME CAPABILITY MANIFEST above.
If the capability is AVAILABLE, explain clearly that you can generate high-quality AI images (via FLUX.1) and AI videos (via Wan2.1), and invite the user to describe what they would like you to generate (e.g., "Generate an image of a black obsidian sphere" or "Create a two-second video of an ocean wave").
Do NOT execute any tools or task plans for this capability inquiry.`,
    };
  }

  // Video generation intent patterns (explicit video requests or rich cinematic scene descriptions with camera motion)
  const videoPatterns = [
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)?videos?\b/,
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)?(?:cinematic\s+scene|action\s+scene|motion\s+scene|dramatic\s+scene|thriller\s+scene|chase\s+scene)\b/,
    /\bvideo\s+of\b/,
    /\banimate\b/,
    /\banimation\s+of\b/,
    /\bmotion\s+clip\b/,
    /\b(?:two|three|four|five|\d+)[-\s]+second\s+video\b/,
    /\btext[- ]to[- ]video\b/,
    /\bt2v\b/,
    /\bwan2\.1\b/,
    /\b(?:camera\s+movement|camera\s+motion|tracking\s+camera|tracking\s+shot|dolly\s+shot|dolly\s+zoom|panning\s+shot|pan\s+across|camera\s+move|cinematic\s+shot)\b/,
  ];

  const isVideoIntent =
    !isMediaCapabilityQuery &&
    !isSoftwareVideoTask &&
    !isPlanningOrDiagramTask &&
    videoPatterns.some((pattern) => pattern.test(lower));

  if (isVideoIntent) {
    const duration = extractVideoDurationSeconds(content) || 2;
    const dims = extractDimensions(content) || { width: 480, height: 480 };

    const toolsToActivate = ["media_video_generate"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }

    return {
      intent: "media_video",
      confidence: 0.95,
      toolsToActivate,
      extractedParameters: {
        duration_seconds: duration,
        width: dims.width,
        height: dims.height,
        fps: 16,
        model: "wan2.1-t2v-1.3b",
      },
      systemGuidance: `[Intent Router: Detected Video Generation Request]
The user wants to generate an AI video. Tool 'media_video_generate' has been activated.
For clear scene descriptions, execute 'media_video_generate' directly without asking for clarification.
Do NOT say 'Generating now' before executing the tool call. Call 'media_video_generate' directly with:
- prompt: Detailed description of scene motion and elements based on user request
- duration_seconds: ${duration}
- width: ${dims.width}
- height: ${dims.height}
- fps: 16
- model: "wan2.1-t2v-1.3b"`,
    };
  }

  // Image generation intent patterns
  const imagePatterns = [
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)?(?:images?|pictures?|photos?|illustrations?|artworks?|paintings?|graphics?|scenes?|visuals?|wallpapers?|portraits?|landscapes?)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:[\w-]+\s+)?(?:images?|pictures?|photos?|illustrations?|artworks?|paintings?|portraits?|scenes?|landscapes?|characters?|creatures?|animals?|cats?|dogs?|spheres?|avatars?|objects?|backgrounds?|wallpapers?)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:a|an|the)\s+(?!(?:out|up|plan|diagram|architecture|flowchart|schema|class|interface|function|code|test|table|api|migration|solution|system)\b)[\w\s]{2,40}\b/,
    /\b(?:image|picture|photo|illustration|artwork|drawing|painting)\s+of\b/,
    /\btext[- ]to[- ]image\b/,
    /\bt2i\b/,
    /\bflux(?:\.1)?\b/,
    /\bdiffusion\s+render\b/,
  ];

  const isImageIntent =
    !isMediaCapabilityQuery &&
    !isSoftwareImageTask &&
    !isPlanningOrDiagramTask &&
    imagePatterns.some((pattern) => pattern.test(lower));

  if (isImageIntent) {
    const dims = extractDimensions(content) || { width: 512, height: 512 };
    const toolsToActivate = ["media_image_generate"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }

    return {
      intent: "media_image",
      confidence: 0.95,
      toolsToActivate,
      extractedParameters: {
        width: dims.width,
        height: dims.height,
        steps: 4,
        model: "black-forest-labs/FLUX.1-schnell",
      },
      systemGuidance: `[Intent Router: Detected Image Generation Request]
The user wants to generate an AI image. Tool 'media_image_generate' has been activated.
Execute 'media_image_generate' with:
- prompt: Detailed visual prompt describing scene, lighting, style, and subject
- width: ${dims.width}
- height: ${dims.height}
- steps: 4
- model: "black-forest-labs/FLUX.1-schnell"`,
    };
  }

  // 3. Ambiguous or Under-specified Requests (e.g. "do it", "run it", "test", "fix it", "execute")
  // Must be checked before system operations / software engineering / conversation to prevent false execution
  const isAmbiguous =
    /^(?:do\s+it|run\s+it|fix\s+it|execute\s+it|try\s+it|go|start|test|run|fix|execute)$/i.test(
      lower.trim(),
    );

  if (isAmbiguous) {
    return {
      intent: "ambiguous",
      confidence: 0.9,
      toolsToActivate: [],
      systemGuidance: `[Intent Router: Detected Ambiguous Request]
The user's request is ambiguous or underspecified. Do NOT speculate or execute any tools, terminal commands, or installations.
Politely ask the user for clarification on what specific task or operation they want to perform.`,
    };
  }

  // 4. System Operations Intent (e.g. "install this package", "install and verify dependencies", "debug the server", "run the test suite")
  const isSystemOperation =
    /\b(?:install|add|remove|uninstall)\b.*\b(?:package|dependency|dependencies|library|module|packages)s?\b/i.test(
      lower,
    ) ||
    /\b(?:npm|pnpm|yarn|pip|cargo|apt|brew)\s+(?:install|add|i|remove|uninstall|update|run|test|build)\b/i.test(
      lower,
    ) ||
    /\b(?:debug|restart|stop|start|kill|check)\s+(?:the\s+|this\s+)?(?:server|backend|service|process|daemon|container|docker)\b/i.test(
      lower,
    ) ||
    /\b(?:run|execute)\s+(?:the\s+|this\s+)?(?:test\s+suite|unit\s+tests?|integration\s+tests?|e2e\s+tests?|tests?)\b/i.test(
      lower,
    ) ||
    /\b(?:run|execute)\s+(?:vitest|jest|pytest|playwright|biome|eslint|tsc)\b/i.test(lower) ||
    /\b(?:run|execute)\s+(?:git\s+status|git\s+diff|git\s+log|shell|command|terminal|resilient\s+command)\b/i.test(
      lower,
    ) ||
    /\b(?:in\s+the\s+terminal|via\s+shell|using\s+terminal|using\s+shell)\b/i.test(lower);

  if (isSystemOperation) {
    const toolsToActivate = ["execute_shell", "test_runner", "package_manager"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }
    return {
      intent: "system_operation",
      confidence: 0.95,
      toolsToActivate,
      systemGuidance: `[Intent Router: Detected System Operation Request]
The user is explicitly requesting a system, terminal, or test operation.
Use the appropriate execution tools ('execute_shell', 'test_runner', 'package_manager') to complete and verify the operation.`,
    };
  }

  // 5. Software Engineering & Project Development Intent (e.g. "build me a landing page", "create a SaaS dashboard", "implement a CRM feature")
  const isSoftwareEngineering =
    ((isSoftwareVideoTask || isSoftwareImageTask) &&
      /\b(?:build|create|implement|develop|code|write|program|add|scaffold|design)\b/i.test(
        lower,
      )) ||
    /\b(?:build|create|implement|develop|code|program|scaffold|write)\b.*\b(?:landing\s+page|saas|dashboard|crm|feature|api|component|app|application|service|backend|frontend|website|database\s+schema|migration|middleware|function|class|module|endpoint|route|hook|ui|interface|form|modal|view|controller|carousel|gallery|player)\b/i.test(
      lower,
    ) ||
    /\b(?:fix|repair|patch|resolve)\b.*\b(?:bug|issue|error|test\s+failure|lint\s+error|type\s+error|failing\s+tests?|unit\s+tests?|race\s+condition|tests?)\b/i.test(
      lower,
    ) ||
    /\b(?:refactor|rewrite|optimize|update)\b.*\b(?:code|component|function|file|middleware|endpoint|service|repository|implementation)\b/i.test(
      lower,
    ) ||
    /\b(?:check|inspect|view|show|get)\s+(?:git\s+status|git\s+diff|git\s+log|git\s+branch)\b/i.test(
      lower,
    ) ||
    /\bgit\s+(?:status|diff|log|branch|checkout)\b/i.test(lower) ||
    /\bin\s+(?:my|the|this)\s+(?:repository|repo|codebase|workspace|project)\b/i.test(lower) ||
    /\badd\s+(?:a\s+)?(?:new\s+)?feature\s+to\b/i.test(lower);

  if (isSoftwareEngineering) {
    const toolsToActivate = ["tools_search", "task_plan", "task_step", "task_complete"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }
    return {
      intent: "software_engineering",
      confidence: 0.9,
      toolsToActivate,
      systemGuidance: `[Intent Router: Detected Software Engineering Project]
The user is requesting a software development or coding project.
Use the autonomous coding loop: plan with 'task_plan', search and activate required tools with 'tools_search', implement changes, verify with tests/linting, and complete with 'task_complete'.`,
    };
  }

  // 6. Normal Conversation (Default)
  // Covers greetings, conceptual explanations, architectural discussions, ideas, chitchat, and general Q&A
  return {
    intent: "conversation",
    confidence: 0.95,
    toolsToActivate: [],
    systemGuidance: `[Intent Router: Detected Conversational Request]
The user is having a normal conversation, greeting you, seeking an explanation, or exploring ideas.
Respond naturally, helpfully, and directly in conversational text using your language model capabilities.
Do NOT invoke tools, do NOT plan tasks, do NOT execute shell commands, and do NOT search for tools.`,
  };
}

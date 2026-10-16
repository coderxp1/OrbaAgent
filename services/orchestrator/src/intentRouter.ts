import type { ToolRegistry } from "@orbaagent/agent-runtime";
import type { ChatMessage } from "@orbaagent/shared";

export interface IntentRoutingResult {
  intent: "media_image" | "media_video" | "artifact_management" | "general_coding" | "unknown";
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

  const lower = content.toLowerCase();

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
    /\bvideo\s+(?:player|element|tag|component|view|stream|streaming|uploader?|feed|controller|card|modal|dialog|container|pipeline|service|backend|api|endpoint|route)\b/i.test(
      lower,
    );
  const isSoftwareImageTask =
    /\bimage\s+(?:component|carousel|gallery|grid|feed|uploader?|uploading|picker|cropper|compression|optimizer|converter|resizer|pipeline|service|backend|api|endpoint|route|tag|element)\b/i.test(
      lower,
    );
  const isPlanningOrDiagramTask =
    /\b(?:sketch|draw)\s+(?:out|up)\b/i.test(lower) ||
    /\b(?:draw|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:architecture|diagram|flowchart|schema|system|pipeline|wireframe|mockup|solution|plan|roadmap|steps?)\b/i.test(
      lower,
    );

  // Video generation intent patterns
  const videoPatterns = [
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)?video\b/,
    /\bvideo\s+of\b/,
    /\banimate\b/,
    /\banimation\s+of\b/,
    /\bmotion\s+clip\b/,
    /\b(?:two|three|four|five|\d+)[-\s]+second\s+video\b/,
    /\btext[- ]to[- ]video\b/,
    /\bt2v\b/,
    /\bwan2\.1\b/,
  ];

  const isVideoIntent =
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
Execute 'media_video_generate' with:
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
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)?(?:image|picture|photo|illustration|artwork|painting|graphic)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:[\w-]+\s+)?(?:image|picture|photo|illustration|artwork|painting|portrait|scene|landscape|character|creature|animal|cat|dog|sphere|avatar|object|background|wallpaper)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:a|an|the)\s+(?!(?:out|up|plan|diagram|architecture|flowchart|schema|class|interface|function|code|test|table|api|migration|solution|system)\b)[\w\s]{2,40}\b/,
    /\b(?:image|picture|photo|illustration|artwork|drawing|painting)\s+of\b/,
    /\btext[- ]to[- ]image\b/,
    /\bt2i\b/,
    /\bflux(?:\.1)?\b/,
    /\bdiffusion\s+render\b/,
  ];

  const isImageIntent =
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

  return {
    intent: "general_coding",
    confidence: 0.8,
    toolsToActivate: [],
  };
}

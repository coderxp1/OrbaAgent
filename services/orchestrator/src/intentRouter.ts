import type { ToolRegistry } from "@orbaagent/agent-runtime";
import type { ChatMessage } from "@orbaagent/shared";

export interface IntentRoutingResult {
  intent: "media_image" | "media_video" | "general_coding" | "unknown";
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

  const isVideoIntent = videoPatterns.some((pattern) => pattern.test(lower));

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
    /\b(?:draw|paint|sketch|illustrate)\s+(?:an?\s+)?/,
    /\b(?:image|picture|photo|illustration|artwork|drawing|painting)\s+of\b/,
    /\btext[- ]to[- ]image\b/,
    /\bt2i\b/,
    /\bflux(?:\.1)?\b/,
    /\bdiffusion\s+render\b/,
  ];

  const isImageIntent = imagePatterns.some((pattern) => pattern.test(lower));

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

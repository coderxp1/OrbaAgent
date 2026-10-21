import type { ToolRegistry } from "@orbaagent/agent-runtime";
import type { ChatMessage } from "@orbaagent/shared";
import { resolveAttachmentArtifactUrl } from "@orbaagent/shared";

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
  // English
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
  // Spanish
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  // German
  ein: 1,
  eine: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};

/**
 * Parses duration in seconds from user prompt text.
 * Handles English, Spanish, and German patterns like "two-second", "2s", "dos segundos", "5 sekunden", etc.
 */
export function extractVideoDurationSeconds(text: string): number | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  // Pattern 1: word-second (e.g. "two-second", "cuatro segundos", "fünf sekunden")
  const wordMatch = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|ein|eine|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)[-\s]+(?:seconds?|segundos?|sekunden?)\b/,
  );
  if (wordMatch?.[1] && NUMBER_WORDS[wordMatch[1]]) {
    return NUMBER_WORDS[wordMatch[1]];
  }

  // Pattern 2: digit second(s) or Xs (e.g. "2 seconds", "8 segundos", "2s", "5s")
  const digitMatch = lower.match(/\b(\d+)(?:[-\s]*(?:seconds?|segundos?|sekunden?|s))\b/);
  if (digitMatch?.[1]) {
    const val = Number.parseInt(digitMatch[1], 10);
    if (!Number.isNaN(val) && val > 0 && val <= 30) {
      return val;
    }
  }

  return undefined;
}

export type VideoOrientation = "vertical" | "horizontal" | "square";

/**
 * Detects video orientation intent from prompt text across supported languages.
 */
export function extractVideoOrientation(text: string): VideoOrientation | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (/\b(?:vertical|portrait|vertikal|hochformat|9:16|9\/16|tiktok|reels?|shorts?)\b/i.test(lower)) {
    return "vertical";
  }
  if (/\b(?:horizontal|landscape|querformat|apaisado|16:9|16\/9|widescreen)\b/i.test(lower)) {
    return "horizontal";
  }
  if (/\b(?:square|cuadrado|quadratisch|carr[eé]|1:1|1\/1)\b/i.test(lower)) {
    return "square";
  }
  return undefined;
}

/**
 * Extracts resolution dimensions (width x height) if specified in text (e.g. "480x480", "768x768", "1280x720").
 * Automatically snaps dimensions to multiples of 16 to guarantee valid model input.
 */
export function extractDimensions(text: string): { width: number; height: number } | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(\d{3,4})\s*[xX*×]\s*(\d{3,4})\b/);
  if (match?.[1] && match[2]) {
    let w = Number.parseInt(match[1], 10);
    let h = Number.parseInt(match[2], 10);
    if (w >= 256 && w <= 2048 && h >= 256 && h <= 2048) {
      // Diffusers and DiT models strictly require width and height to be divisible by 16.
      // Automatically snap to the nearest multiple of 16 (e.g. 1080 -> 1088).
      w = Math.round(w / 16) * 16;
      h = Math.round(h / 16) * 16;
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

  // The latest user message must not be an explicit software/system request
  const latestUser = messages[messages.length - 1];
  const latestText = latestUser && typeof latestUser.content === "string" ? latestUser.content : "";
  if (
    /\b(?:workspace|directory|folder|repo|repository|git|terminal|shell|bash|npm|pnpm|cargo|pip|compile|build|vitest|jest|refactor|debug|codebase)\b/i.test(
      latestText,
    )
  ) {
    return null;
  }

  let candidatePrompt = "";
  let isVideo = false;
  let duration: number | undefined;
  let width = 480;
  let height = 480;
  let foundAnyMediaContext = false;

  const maxLookback = Math.max(0, messages.length - 8);

  for (let i = messages.length - 2; i >= maxLookback; i--) {
    const msg = messages[i];
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
          : "";

    if (!text.trim()) continue;

    // If an intervening turn is an unrelated domain (software engineering, system, or general technical explanation)
    // and contains NO media references, the prior media context has been superseded. Stop looking further back.
    if (
      msg.role === "user" &&
      !/\b(?:video|image|photo|flux|wan2|prompt|option|go|yes|ok|sure|proceed)\b/i.test(text)
    ) {
      break;
    }
    if (
      msg.role === "assistant" &&
      /\b(?:workspace|terminal|git|qubits?|superposition|algorithm)\b/i.test(text) &&
      !/\b(?:video|image|photo|t2v|t2i|flux|wan2)\b/i.test(text)
    ) {
      break;
    }

    if (
      /\b(?:video|wan2\.1|t2v|fps|seconds?|animation|clip|motion|tracking shot|camera movement|cinematic scene|cinematic prompt|soaring|flying car|hovercar|chase)\b/i.test(
        text,
      )
    ) {
      isVideo = true;
      foundAnyMediaContext = true;
    } else if (
      /\b(?:image|photo|flux|t2i|picture|artwork|portrait|obsidian sphere)\b/i.test(text)
    ) {
      foundAnyMediaContext = true;
    }

    if (!duration) {
      duration = extractVideoDurationSeconds(text);
    }

    const dims = extractDimensions(text);
    if (dims) {
      width = dims.width;
      height = dims.height;
    } else if (/\b16:9\b/i.test(text)) {
      width = 832;
      height = 480;
    } else if (/\b9:16\b/i.test(text)) {
      width = 480;
      height = 832;
    }

    if (msg.role === "assistant" && !candidatePrompt) {
      // 1. Blockquote
      const blockquoteMatches = text.match(/(?:^|\n)>\s*(.*?)(?=\n\n|\n(?=[^>])|$)/gs);
      if (blockquoteMatches && blockquoteMatches.length > 0) {
        candidatePrompt = blockquoteMatches
          .map((b) => b.replace(/(?:^|\n)>\s*/g, " ").trim())
          .join(" ")
          .replace(/^\*\*[^*]+\*\*\s*/, "")
          .trim();
      }

      // 2. Quoted text
      if (!candidatePrompt || candidatePrompt.length < 15) {
        const quotedMatches = text.match(/["“]([^"”]{20,})["”]/);
        if (quotedMatches?.[1]) {
          candidatePrompt = quotedMatches[1].trim();
        }
      }

      // 3. Direct prompt in assistant response (length > 30, visual descriptors, not pure menu)
      if (
        (!candidatePrompt || candidatePrompt.length < 15) &&
        text.length > 30 &&
        /\b(?:soaring|running|chase|skyscrapers|lighting|cinematic|anamorphic|photoreal|reflective|volumetric|camera|shot|hyperrealistic|obsidian|cyberpunk)\b/i.test(
          text,
        ) &&
        !/^(?:how can i help|what do you want me to do next|how long should)/i.test(text.trim())
      ) {
        candidatePrompt = text
          .replace(/^(?:here(?:'s| is) (?:a |the )?(?:suggested |cinematic )?prompt:?\s*)/i, "")
          .trim();
      }
    }

    if (msg.role === "user" && !candidatePrompt && text.trim().length > 25) {
      if (
        /\b(?:prompt for|generate|scene of|image of|video of)\s+(.+)/i.test(text) ||
        /\b(?:soaring|running|chase|skyscrapers|neon|reflective|obsidian|cyberpunk)\b/i.test(text)
      ) {
        candidatePrompt = text
          .replace(
            /^can you (?:please )?(?:suggest|give me|write) (?:a |an )?(?:cinematic )?(?:video |image )?prompt for\s+/i,
            "",
          )
          .trim();
      }
    }
  }

  // Also check the latest user message for duration or dimensions
  if (latestUser?.role === "user") {
    const userDur = extractVideoDurationSeconds(latestText);
    if (userDur) duration = userDur;
    const userDims = extractDimensions(latestText);
    if (userDims) {
      width = userDims.width;
      height = userDims.height;
    } else if (/\b16:9\b/i.test(latestText)) {
      width = 832;
      height = 480;
    } else if (/\b9:16\b/i.test(latestText)) {
      width = 480;
      height = 832;
    }
    if (/\bvideo\b/i.test(latestText)) isVideo = true;
    if (/\bimage\b/i.test(latestText)) isVideo = false;
  }

  if (!candidatePrompt || !foundAnyMediaContext) return null;

  return {
    type: isVideo ? "video" : "image",
    prompt: candidatePrompt,
    duration: isVideo ? duration || 5 : undefined,
    width,
    height,
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
    /^(?:ok|okay|yes|sure|go|proceed|do it|generate it|make it|render it|create it|start it|run it|use that(?:\s+suggested)?\s+prom?p?t?|use this(?:\s+suggested)?\s+prom?p?t?|sounds good|looks good|option\s+\d+|use\s+option\s+\d+)(?:[,\s.!?-]+(?:go|proceed|generate(?:\s+it)?|do\s+it|use\s+that(?:\s+suggested)?\s+prom?p?t?|please|ahead|\d+s|16:9|9:16|1:1))*$/i.test(
      lower,
    ) ||
    /\b(?:use\s+that(?:\s+suggested)?\s+prom?p?t?|use\s+this(?:\s+suggested)?\s+prom?p?t?|yes\s*,?\s*(?:please\s*,?\s*)?(?:generate|create|make|do\s+it|go)|ok\s*,?\s*(?:go|generate|create|make\s+it|use\s+that)|go\s+ahead(?:\s+and\s+generate)?|option\s+\d+.*go|go.*option\s+\d+)\b/i.test(
      lower,
    );

  const isExplicitSoftwareOrSystem =
    /\b(?:workspace|directory|folder|repo|repository|git status|git commit|git diff|git log|terminal|shell|bash|npm|pnpm|cargo|pip|compile|build|unit test|vitest|jest|refactor|debug|fix bug|codebase)\b/i.test(
      lower,
    );

  if (isConfirmation && !isExplicitSoftwareOrSystem) {
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
        },
        systemGuidance: `[Intent Router: Resumed Pending Media Generation]
The user approved the pending ${pendingMedia.type} generation task ("${content}").
Tool '${toolToActivate}' is ACTIVE and ready to execute.
EXECUTE '${toolToActivate}' IMMEDIATELY with:
- prompt: ${JSON.stringify(pendingMedia.prompt)}
${isVideo ? `- duration_seconds: ${pendingMedia.duration || 5}\n- width: ${pendingMedia.width || 480}\n- height: ${pendingMedia.height || 480}\n- fps: 16` : `- width: ${pendingMedia.width || 512}\n- height: ${pendingMedia.height || 512}\n- steps: 4`}
DO NOT ask for further confirmation or explain how to run it. Call '${toolToActivate}' directly now.`,
      };
    }
  }

  // 0b. Multi-Turn Image Refinement & Style Correction Check (e.g. "But I want a real human female please", "make it a real person", "make her photorealistic", "change her clothing to red")
  const isImageRefinementOrEdit =
    /\b(?:real\s+human|real\s+person|photorealistic|realistic|human\s+female|human\s+male|real\s+woman|real\s+man)\b/i.test(
      lower,
    ) ||
    /\b(?:not\s+an?\s+avatar|not\s+a\s+cartoon|not\s+3d|not\s+cgi|more\s+realistic|actual\s+person|actual\s+human)\b/i.test(
      lower,
    ) ||
    /\b(?:change|replace|modify|update|edit|adjust|alter|swap)\s+(?:the|her|his|its|this)?\s*(?:clothing|dress|outfit|background|hair|lighting|face|setting|color)\b/i.test(
      lower,
    );

  const hasRecentImageContext = messages.some((m) => {
    const txt =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? JSON.stringify(m.content)
          : "";
    return (
      /\b(?:image|photo|picture|flux|portrait|avatar|jewelry|dress)\b/i.test(txt) ||
      (m.toolCalls && m.toolCalls.some((c) => c.name === "media_image_generate"))
    );
  });

  if (isImageRefinementOrEdit && hasRecentImageContext && !isExplicitSoftwareOrSystem) {
    const toolsToActivate = ["media_image_generate"];
    if (registry) {
      registry.activateTools(toolsToActivate);
    }
    return {
      intent: "media_image",
      confidence: 0.98,
      toolsToActivate,
      extractedParameters: {
        width: 1024,
        height: 1024,
        steps: 4,
        model: "black-forest-labs/FLUX.1-schnell",
      },
      systemGuidance: `[Intent Router: Detected Image Refinement / Style Correction]
The user is refining or modifying a previously generated or requested image ("${content}").
Tool 'media_image_generate' is ACTIVE and MUST be invoked immediately.
POLICY FOR PHOTOREALISTIC HUMANS & COMMERCIAL MODELS:
- Generating fictional photorealistic adult humans, commercial models, fashion photography, and business advertising imagery is 100% PERMITTED and encouraged.
- The phrase "real human", "real person", or "photorealistic female/male" indicates a desire for lifelike photographic rendering rather than a 3D avatar/cartoon style. It is NOT an attempt to identify or impersonate a living individual.
- DO NOT refuse. DO NOT present questionnaires or safety disclaimers.
- EXECUTE 'media_image_generate' IMMEDIATELY with a rich, detailed, hyperrealistic photographic prompt incorporating the user's specific attributes (natural skin texture, authentic skin pores, lifelike eyes with realistic specular highlights, fine hair strands, authentic lighting, and high-end commercial editorial quality).`,
    };
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
If the capability is AVAILABLE, explain clearly that you can generate high-quality AI images and AI videos, and invite the user to describe what they would like you to generate (e.g., "Generate an image of a black obsidian sphere" or "Create a two-second video of an ocean wave").
Do NOT execute any tools or task plans for this capability inquiry.`,
    };
  }

  // Video generation intent patterns (explicit video requests in English, Spanish, German, French, commercials, or rich cinematic scenes)
  const videoPatterns = [
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)*videos?\b/,
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)*(?:cinematic\s+scene|action\s+scene|motion\s+scene|dramatic\s+scene|thriller\s+scene|chase\s+scene|clip|animation|commercial|advertisement|promo|trailer)\b/,
    // Spanish patterns: "genera un vídeo con un conejo blanco bailando", "crea un video de...", "haz un video..."
    /\b(?:genera|generar|crea|crear|haz|hacer|produce|producir|renderiza|renderizar)\s+(?:un\s+)?(?:[\w-]+\s+)*(?:v[ií]deos?|clips?|cortometrajes?|animaci[oó]n|anuncio|spot|comercial)\b/,
    /\bv[ií]deo\s+(?:de|con|sobre)\b/,
    /\bun\s+v[ií]deo\b/,
    // German patterns: "erstelle ein video von einem tanzenden weißen kaninchen", "generiere ein video..."
    /\b(?:erstelle|erstellen|generiere|generieren|mache|machen|erzeuge|erzeugen|produziere|produzieren)\s+(?:ein\s+)?(?:[\w-]+\s+)*(?:videos?|clips?|kurzfilm|animation|werbung|werbespot)\b/,
    /\bvideo\s+(?:von|mit|[uü]ber)\b/,
    /\bein\s+video\b/,
    // French patterns: "génère une vidéo de...", "crée une vidéo..."
    /\b(?:g[eé]n[eè]re|g[eé]n[eé]rer|cr[eé]e|cr[eé]er|fais|faire|produis|produire)\s+(?:une?\s+)?(?:[\w-]+\s+)*(?:vid[eé]os?|clips?|animation|publicit[eé])\b/,
    /\bvid[eé]o\s+(?:de|avec|sur)\b/,
    /\bune\s+vid[eé]o\b/,
    /\bvideo\s+of\b/,
    /\banimate\b/,
    /\banimation\s+of\b/,
    /\bmotion\s+clip\b/,
    /\b(?:two|three|four|five|\d+)[-\s]+second\s+(?:video|clip|animation|scene|commercial|ad)\b/,
    /\btext[- ]to[- ]video\b/,
    /\bt2v\b/,
    /\bcommercial\b/,
    /\badvertisement\b/,
    /\b(?:camera\s+movement|camera\s+motion|tracking\s+camera|tracking\s+shot|dolly\s+shot|dolly\s+zoom|panning\s+shot|pan\s+across|camera\s+move|cinematic\s+shot)\b/,
  ];

  const isExplicitImageWord =
    /\b(?:image|photo|photograph|picture|illustration|painting|drawing|wallpaper)\b/i.test(lower);
  const isExplicitVideoWord =
    /\b(?:video|clip|animation|footage|v[ií]deo|kurzfilm|spot|animaci[oó]n|commercial\s+video)\b/i.test(lower);

  const isVideoIntent =
    !isMediaCapabilityQuery &&
    !isSoftwareVideoTask &&
    !isPlanningOrDiagramTask &&
    (!isExplicitImageWord || isExplicitVideoWord) &&
    videoPatterns.some((pattern) => pattern.test(lower));

  if (isVideoIntent) {
    const isCommercial = /\b(?:commercial|advertisement|promo|trailer|viral\s+commercial|anuncio|spot|werbespot)\b/i.test(
      lower,
    );
    const explicitDuration = extractVideoDurationSeconds(content);
    // Sensible default when the user does not specify a duration: 5s.
    // (Previously 3s, which produced unexpectedly short clips that the
    // player then reported as ~3 seconds regardless of expectations.)
    const duration = explicitDuration || (isCommercial ? 15 : 5);

    // Resolve orientation and enforce 16-divisible dimensions
    const orientation = extractVideoOrientation(content);
    let dims = extractDimensions(content);
    if (!dims) {
      if (orientation === "vertical") {
        dims = { width: 720, height: 1280 }; // 9:16 portrait (720%16=0, 1280%16=0)
      } else if (orientation === "horizontal") {
        dims = { width: 1280, height: 720 }; // 16:9 landscape (1280%16=0, 720%16=0)
      } else if (orientation === "square") {
        dims = { width: 720, height: 720 }; // 1:1 square (720%16=0)
      } else {
        dims = { width: 1280, height: 720 }; // Default 16:9 landscape
      }
    } else {
      // Enforce strict divisibility by 16 on any explicitly extracted dimensions
      dims = {
        width: Math.round(dims.width / 16) * 16,
        height: Math.round(dims.height / 16) * 16,
      };
    }

    // Detect image attachment from turn messages
    let attachedImageUrl: string | undefined;
    if (Array.isArray(latestMessage?.content)) {
      const imgPart = latestMessage.content.find(
        (c: any) => c.type === "image_url" && (c as any).image_url?.url,
      );
      if (imgPart && "image_url" in (imgPart as any)) attachedImageUrl = (imgPart as any).image_url.url;
    }
    if (!attachedImageUrl && (latestMessage as any)?.attachments?.length > 0) {
      const att = (latestMessage as any).attachments.find(
        (a: any) =>
          a.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name || ""),
      );
      if (att) {
        // Canonical artifact reference only: a direct artifact URL or
        // the URL decoded from the artifactId. Preview URLs and bare
        // filenames are NOT usable references (incident 2026-10-21).
        attachedImageUrl = resolveAttachmentArtifactUrl(att);
      }
    }

    // Detect user requested style
    const isExplicitCartoon =
      /\b(?:cartoon|dibujo|dibujos\s+animados|animaci[oó]n\s+2d|caricatura|anime|manga|pixar|disney|toon|doodle|sketch|comic)\b/i.test(
        lower,
      );

    const toolsToActivate = ["media_video_generate", "artifact_read", "artifact_list"];
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
        orientation: orientation || (dims.height > dims.width ? "vertical" : "horizontal"),
        ...(attachedImageUrl ? { image_url: attachedImageUrl } : {}),
      },
      systemGuidance: `[Intent Router: Detected ${isCommercial ? "Commercial Video" : "Video"} Generation Request]
The user wants to generate ${isCommercial ? "a commercial video" : "an AI video"} ("${content}"). Tool 'media_video_generate' has been activated.
ACTION-ORIENTED EXECUTION POLICY (ZERO QUESTIONNAIRES):
- DO NOT interrogate the user with questionnaires about orientation, duration, style, location, camera movement, or audio.
- DO NOT present a multi-turn survey or ask "¿Lo genero con el preset por defecto?" or "Dime tus preferencias".
- Infer sensible defaults immediately:
  * Duration: ${duration}s
  * Dimensions: ${dims.width}x${dims.height} (${orientation || (dims.height > dims.width ? "vertical 9:16 portrait" : "standard 16:9 landscape")})
  * Orientation: ${orientation || (dims.height > dims.width ? "vertical" : "horizontal")}
  * Visual style: ${
    isExplicitCartoon
      ? "Stylized cartoon/animation as explicitly requested by user"
      : "Photorealistic live-action by default. Use lifelike fur/skin textures, natural anatomy, stable lighting, and coherent physical motion. Never invent cartoon/doodle aesthetics unless explicitly requested."
  }
CONTENT & PROMPT PRESERVATION POLICY:
- You MUST preserve ALL requested subjects, people, products, brands, actions, dialogue, and orientation exactly as requested by the user.
- NEVER replace the user's specific subjects or products with generic boilerplate text.
- If dialogue or speech is requested ("saying ...", quotes), include the spoken phrase explicitly so the audio engine synthesizes dialogue.
- EXECUTE 'media_video_generate' IMMEDIATELY on this first turn.
- Briefly acknowledge in the user's language (Spanish, English, German, etc.) and run the tool now.
${attachedImageUrl ? `- Photo Conditioning: The user provided an attached image/photo. Pass image_url: "${attachedImageUrl}" directly to 'media_video_generate'. Describe the person/subject, appearance, lighting, and realistic movement matching the photo faithfully.\n` : ""}Call 'media_video_generate' directly with:
- prompt: Detailed description preserving all user-requested subjects, brands, and dialogue: "${content.replace(/"/g, '\\"')}"
- orientation: "${orientation || (dims.height > dims.width ? "vertical" : "horizontal")}"
- negative_prompt: ${
  isExplicitCartoon
    ? "photorealistic, hyperrealistic, deformed, blurry"
    : "cartoon, anime, 3d render, cgi, blurry, distorted, doodle, sketch, low quality, deformed, artificial"
}
- duration_seconds: ${duration}
- width: ${dims.width}
- height: ${dims.height}
- fps: 16${attachedImageUrl ? `\n- image_url: "${attachedImageUrl}"` : ""}`,
    };
  }

  // Image generation & editing intent patterns
  const imagePatterns = [
    /\b(?:create|generate|make|render|produce)\s+(?:an?\s+)?(?:[\w-]+\s+)*(?:images?|pictures?|photos?|photographs?|illustrations?|artworks?|paintings?|graphics?|scenes?|visuals?|wallpapers?|portraits?|landscapes?)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:[\w-]+\s+)*(?:images?|pictures?|photos?|photographs?|illustrations?|artworks?|paintings?|portraits?|scenes?|landscapes?|characters?|creatures?|animals?|cats?|dogs?|spheres?|avatars?|objects?|backgrounds?|wallpapers?)\b/,
    // Requests for realistic human models, people, portraits, fashion models
    /\b(?:create|generate|make|render|produce|show|give\s+me)\s+(?:an?\s+)?(?:[\w-]+\s+)*(?:real\s+human|realistic\s+human|photorealistic\s+human|human\s+model|female\s+model|male\s+model|fashion\s+model|commercial\s+model|woman|man|person|lady|girl|guy)\b/,
    /\b(?:real\s+human|realistic\s+human|photorealistic\s+human|photorealistic\s+woman|photorealistic\s+man|real\s+person|human\s+female|human\s+male)\s*(?:please)?\b/,
    /\b(?:portrait|headshot|fashion\s+photo|lifestyle\s+photo|commercial\s+photo|editorial\s+photo)\s+(?:of|with|showing)\b/,
    // Image editing and modification patterns
    /\b(?:edit|modify|change|replace|alter|transform|adjust|update|retouch|enhance|upscale)\s+(?:the\s+|this\s+|an?\s+)?(?:image|photo|photograph|picture|attachment|upload|background|clothing|dress|outfit|lighting|setting|face|person|model|product)\b/,
    /\b(?:change|replace|swap|turn|make)\s+(?:the\s+|her\s+|his\s+|its\s+)?(?:background|dress|clothing|outfit|lighting|hair|eyes|style)\s+(?:to|into|with)\b/,
    /\bput\s+(?:the|this|a|an)\s+(?:person|model|product|subject|item)\s+(?:in|on|into|at)\b/,
    /\b(?:genera|generar|crea|crear|haz|hacer|produce|producir|dibuja|dibujar)\s+(?:una?\s+)?(?:[\w-]+\s+)*(?:im[aá]genes?|fotos?|fotograf[ií]as?|ilustraci[oó]n|ilustraciones?|dibujos?)\b/,
    /\b(?:erstelle|erstellen|generiere|generieren|mache|machen|zeichne|zeichnen)\s+(?:ein\s+)?(?:[\w-]+\s+)*(?:bilder?|fotos?|illustrationen?|zeichnungen?)\b/,
    /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:a|an|the)\s+(?!(?:out|up|plan|diagram|architecture|flowchart|schema|class|interface|function|code|test|table|api|migration|solution|system)\b)[\w\s]{2,40}\b/,
    /\b(?:image|picture|photo|photograph|illustration|artwork|drawing|painting)\s+of\b/,
    /\b(?:imagen|foto|fotograf[ií]a|dibujo)\s+de\b/,
    /\b(?:bild|foto|zeichnung)\s+von\b/,
    /\btext[- ]to[- ]image\b/,
    /\bt2i\b/,
    /\bdiffusion\s+render\b/,
  ];

  const isImageIntent =
    !isMediaCapabilityQuery &&
    !isSoftwareImageTask &&
    !isPlanningOrDiagramTask &&
    imagePatterns.some((pattern) => pattern.test(lower));

  if (isImageIntent) {
    const dims =
      extractDimensions(content) ||
      (/\b(?:16:9|landscape|wide|wallpaper|banner)\b/i.test(content)
        ? { width: 1344, height: 768 }
        : /\b(?:9:16|portrait|vertical|story|stories)\b/i.test(content)
          ? { width: 768, height: 1344 }
          : { width: 1024, height: 1024 });

    // Detect image attachment from turn messages
    let attachedImageUrl: string | undefined;
    if (Array.isArray(latestMessage?.content)) {
      const imgPart = latestMessage.content.find(
        (c: any) => c.type === "image_url" && (c as any).image_url?.url,
      );
      if (imgPart && "image_url" in (imgPart as any)) attachedImageUrl = (imgPart as any).image_url.url;
    }
    if (!attachedImageUrl && (latestMessage as any)?.attachments?.length > 0) {
      const att = (latestMessage as any).attachments.find(
        (a: any) =>
          a.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name || ""),
      );
      if (att) {
        // Canonical artifact reference only: a direct artifact URL or
        // the URL decoded from the artifactId. Preview URLs and bare
        // filenames are NOT usable references (incident 2026-10-21).
        attachedImageUrl = resolveAttachmentArtifactUrl(att);
      }
    }

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
        ...(attachedImageUrl ? { image_url: attachedImageUrl } : {}),
      },
      systemGuidance: `[Intent Router: Detected Image Generation / Editing Request]
The user wants to generate or edit an AI image ("${content}"). Tool 'media_image_generate' has been activated.
Execute 'media_image_generate' directly without questioning or surveys:
POLICY FOR PHOTOREALISTIC HUMANS & COMMERCIAL MODELS:
- Generating fictional photorealistic adult humans, commercial models, fashion photography, and business advertising imagery is 100% PERMITTED and encouraged.
- Fictional adult humans/models: Describe natural skin texture with subtle pores, authentic specular highlights, realistic hair strands, authentic lighting, and high-end commercial editorial quality.
- Suppress cartoon, 3D, and CGI artifacts unless specifically requested: negative_prompt: "3d render, cartoon, anime, doll, plastic skin, cgi, airbrushed, drawing, avatar, fake, deformed".
- When an uploaded reference image is provided (${attachedImageUrl ? `image_url: "${attachedImageUrl}"` : "attachments"}), incorporate the subject, product, or person faithfully and apply the requested background, outfit, or lighting changes.
- width: ${dims.width}
- height: ${dims.height}
- steps: 4${attachedImageUrl ? `\n- image_url: "${attachedImageUrl}"` : ""}`,
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

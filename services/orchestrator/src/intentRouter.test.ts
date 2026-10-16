import { ToolRegistry } from "@orbaagent/agent-runtime";
import type { ChatMessage } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { extractDimensions, extractVideoDurationSeconds, routeUserIntent } from "./intentRouter.js";

describe("Natural-Language Intent Routing", () => {
  describe("extractVideoDurationSeconds", () => {
    it("extracts duration from word-hyphenated format", () => {
      expect(extractVideoDurationSeconds("Create a two-second video of an ocean wave")).toBe(2);
      expect(extractVideoDurationSeconds("Make a four-second clip")).toBe(4);
      expect(extractVideoDurationSeconds("Generate a ten second animation")).toBe(10);
    });

    it("extracts duration from digit-unit format", () => {
      expect(extractVideoDurationSeconds("Generate 5s video of a rocket launch")).toBe(5);
      expect(extractVideoDurationSeconds("Create a 3-second video")).toBe(3);
      expect(extractVideoDurationSeconds("video with 2 seconds duration")).toBe(2);
    });

    it("returns undefined when no duration is specified", () => {
      expect(extractVideoDurationSeconds("Generate a video of a flying eagle")).toBeUndefined();
    });
  });

  describe("extractDimensions", () => {
    it("extracts width and height from resolution patterns", () => {
      expect(extractDimensions("resolution 480x480")).toEqual({ width: 480, height: 480 });
      expect(extractDimensions("768x768 pixels")).toEqual({ width: 768, height: 768 });
      expect(extractDimensions("1024*1024")).toEqual({ width: 1024, height: 1024 });
    });

    it("returns undefined when no valid dimensions are found", () => {
      expect(extractDimensions("standard square size")).toBeUndefined();
    });
  });

  describe("routeUserIntent", () => {
    it("routes 'Generate an image of a black obsidian sphere' to media_image_generate", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();
      expect(registry.getActiveToolNames()).not.toContain("media_image_generate");

      const messages: ChatMessage[] = [
        { role: "user", content: "Generate an image of a black obsidian sphere." },
      ];

      const result = routeUserIntent(messages, registry);

      expect(result.intent).toBe("media_image");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.toolsToActivate).toContain("media_image_generate");
      expect(registry.getActiveToolNames()).toContain("media_image_generate");
      expect(result.systemGuidance).toContain("media_image_generate");
    });

    it("routes 'Create a two-second video of an ocean wave at sunset' to media_video_generate with duration", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();
      expect(registry.getActiveToolNames()).not.toContain("media_video_generate");

      const messages: ChatMessage[] = [
        { role: "user", content: "Create a two-second video of an ocean wave at sunset." },
      ];

      const result = routeUserIntent(messages, registry);

      expect(result.intent).toBe("media_video");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.toolsToActivate).toContain("media_video_generate");
      expect(registry.getActiveToolNames()).toContain("media_video_generate");
      expect(result.extractedParameters?.duration_seconds).toBe(2);
      expect(result.systemGuidance).toContain("duration_seconds: 2");
    });

    it("routes variations of image requests appropriately", () => {
      const registry = new ToolRegistry();

      const prompts = [
        "Please draw a cute red panda wearing glasses",
        "Make a picture of a futuristic city with flying cars",
        "Render a photo of a snowy mountain peak at sunrise",
        "Generate artwork of an abstract neon sculpture",
      ];

      for (const prompt of prompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("media_image");
        expect(result.toolsToActivate).toContain("media_image_generate");
        expect(registry.getActiveToolNames()).toContain("media_image_generate");
      }
    });

    it("routes variations of video requests appropriately", () => {
      const registry = new ToolRegistry();

      const prompts = [
        "Generate a video of raindrops falling on a glass window",
        "Create an animation of a galaxy rotating in deep space",
        "Make a motion clip of a waterfall in the rainforest",
      ];

      for (const prompt of prompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("media_video");
        expect(result.toolsToActivate).toContain("media_video_generate");
        expect(registry.getActiveToolNames()).toContain("media_video_generate");
      }
    });

    it("routes conversational requests, greetings, and technical explanations to 'conversation' with zero tools", () => {
      const registry = new ToolRegistry();

      const conversationalPrompts = [
        "Hey Orba, how are you?",
        "What do you think about this idea?",
        "Explain how AI agents work.",
        "Can you sketch out a plan for database migrations?",
        "Draw an architecture diagram for the microservices",
        "Can you sketch a solution to the race condition in auth middleware?",
        "Tell me about transformer attention mechanisms",
        "Hello!",
      ];

      for (const prompt of conversationalPrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("conversation");
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result.toolsToActivate).toHaveLength(0);
        expect(result.systemGuidance).toContain("Conversational Request");
      }
    });

    it("routes media capability questions ('Can you generate images?', 'Can you generate videos?') to conversation without triggering generation tools", () => {
      const registry = new ToolRegistry();

      const capabilityPrompts = [
        "Can you generate images?",
        "Can you generate videos?",
        "Can you create images?",
        "Can you make videos?",
        "Are you able to generate images?",
        "Are you able to create videos?",
        "Do you support image generation?",
        "Do you support video generation?",
      ];

      for (const prompt of capabilityPrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("conversation");
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result.toolsToActivate).toHaveLength(0);
        expect(result.systemGuidance).toContain("Media Capability Inquiry");
        expect(registry.getActiveToolNames()).not.toContain("media_image_generate");
        expect(registry.getActiveToolNames()).not.toContain("media_video_generate");
      }
    });

    it("routes explicit software engineering and project requests to 'software_engineering'", () => {
      const registry = new ToolRegistry();

      const softwarePrompts = [
        "Build me a landing page.",
        "Create a SaaS dashboard.",
        "Implement a CRM feature in my repository.",
        "Fix the unit tests in services/orchestrator/src/orchestrator.test.ts",
        "Refactor the authentication middleware to use JWT tokens",
        "Create a video player component in React with playback controls",
        "Build an image upload endpoint in Express with multipart parsing",
        "Create an image carousel using CSS flexbox and transitions",
        "Build a video streaming service backend in Node.js",
      ];

      for (const prompt of softwarePrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("software_engineering");
        expect(result.toolsToActivate).toContain("task_plan");
        expect(result.toolsToActivate).not.toContain("media_image_generate");
        expect(result.toolsToActivate).not.toContain("media_video_generate");
        expect(registry.getActiveToolNames()).not.toContain("media_image_generate");
        expect(registry.getActiveToolNames()).not.toContain("media_video_generate");
      }
    });

    it("routes explicit system, terminal, and test execution operations to 'system_operation'", () => {
      const registry = new ToolRegistry();

      const systemPrompts = [
        "Install this package.",
        "Debug the server.",
        "Run the test suite.",
        "Run git status and show me what changed",
        "Install the new dependency with pnpm add",
        "Execute vitest in services/orchestrator",
      ];

      for (const prompt of systemPrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("system_operation");
        expect(result.toolsToActivate).toContain("execute_shell");
        expect(registry.getActiveToolNames()).toContain("execute_shell");
      }
    });

    it("routes ambiguous and underspecified requests to 'ambiguous' without speculating", () => {
      const ambiguousPrompts = ["do it", "run it", "test", "fix it", "execute"];

      for (const prompt of ambiguousPrompts) {
        const result = routeUserIntent([{ role: "user", content: prompt }]);
        expect(result.intent).toBe("ambiguous");
        expect(result.toolsToActivate).toHaveLength(0);
        expect(result.systemGuidance).toContain("Ambiguous Request");
      }
    });

    it("routes artifact listing and review queries to artifact_management with artifact tools active", () => {
      const registry = new ToolRegistry();

      const artifactPrompts = [
        "Show me all generated media artifacts",
        "List artifacts in my workspace",
        "What videos did you generate earlier?",
        "Inspect the generated images and files",
      ];

      for (const prompt of artifactPrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("artifact_management");
        expect(result.toolsToActivate).toContain("artifact_list");
        expect(result.toolsToActivate).toContain("artifact_read");
        expect(registry.getActiveToolNames()).toContain("artifact_list");
        expect(registry.getActiveToolNames()).toContain("artifact_read");
        expect(result.systemGuidance).toContain("artifact_list");
      }
    });

    it("routes rich cinematic thriller scene without the word 'video' directly to media_video", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const userPrompt =
        "Generate a cinematic scene of a terrified woman running through a dark, rain-soaked alley at night while a man chases after her. She screams for help as heavy rain pours down, with dramatic lighting, realistic reflections on the wet pavement, tense camera movement, and a suspenseful thriller atmosphere.";

      const result = routeUserIntent([{ role: "user", content: userPrompt }], registry);

      expect(result.intent).toBe("media_video");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.toolsToActivate).toContain("media_video_generate");
      expect(registry.getActiveToolNames()).toContain("media_video_generate");
      expect(result.systemGuidance).toContain("media_video_generate");
    });

    it("resumes pending video generation when user confirms with 'ok, use that suggested promtp' or 'go'", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const conversation: ChatMessage[] = [
        {
          role: "user",
          content:
            "Generate a cinematic scene of a terrified woman running through a dark, rain-soaked alley at night while a man chases after her. She screams for help as heavy rain pours down, with dramatic lighting, realistic reflections on the wet pavement, tense camera movement, and a suspenseful thriller atmosphere.",
        },
        {
          role: "assistant",
          content:
            "I can generate AI video with Wan2.1, but I can't start or attach a render from this chat turn. Here's a generation-ready prompt:\n\n> **Cinematic thriller scene, nighttime.** A terrified adult woman runs through a narrow, dark city alley in a heavy downpour, shouting for help as a man pursues her several steps behind. Rain lashes the scene and streams off fire escapes; puddles shimmer with broken reflections of cold blue streetlights and a flickering amber sign. Handheld tracking camera retreats in front of her, slightly unsteady, then cuts briefly to the pursuer's silhouette and back to her desperate face. Breathless, urgent movement; realistic rain and wet clothing; dramatic shadows, shallow depth of field, high-contrast cinematic lighting, suspenseful atmosphere.",
        },
        {
          role: "user",
          content: "ok, use that suggested promtp",
        },
      ];

      const result = routeUserIntent(conversation, registry);

      expect(result.intent).toBe("media_video");
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.toolsToActivate).toContain("media_video_generate");
      expect(registry.getActiveToolNames()).toContain("media_video_generate");
      expect(result.extractedParameters?.prompt).toContain(
        "A terrified adult woman runs through a narrow, dark city alley",
      );
      expect(result.systemGuidance).toContain("Resumed Pending Media Generation");
      expect(result.systemGuidance).toContain("media_video_generate");
    });

    it("resumes pending image generation when user confirms with 'go' or 'yes'", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const conversation: ChatMessage[] = [
        {
          role: "user",
          content: "Can you create an image of a black obsidian sphere on a marble pedestal?",
        },
        {
          role: "assistant",
          content:
            "Yes, I can generate that with FLUX.1. Suggested prompt:\n\n> A polished black obsidian sphere reflecting studio rim lights, resting on a white Carrara marble pedestal with soft cinematic shadows.\n\nWould you like me to generate this now?",
        },
        {
          role: "user",
          content: "go",
        },
      ];

      const result = routeUserIntent(conversation, registry);

      expect(result.intent).toBe("media_image");
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.toolsToActivate).toContain("media_image_generate");
      expect(registry.getActiveToolNames()).toContain("media_image_generate");
      expect(result.extractedParameters?.prompt).toContain("polished black obsidian sphere");
      expect(result.systemGuidance).toContain("media_image_generate");
    });

    it("resumes pending media generation across a multi-turn clarification sequence when user says 'yes, go'", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const conversation: ChatMessage[] = [
        {
          role: "user",
          content:
            "Can you suggest a cinematic prompt for a cyberpunk hovercar soaring between glowing neon skyscrapers in the rain?",
        },
        {
          role: "assistant",
          content:
            "Cyberpunk hovercar chase, soaring between towering neon-lit skyscrapers at night in heavy rain — low-angle tracking shot that tilts up as the car rockets past, blue/magenta holographic billboards reflecting on wet chrome, volumetric fog and god rays cutting through steam vents, raindrops streaking across the lens, bright rim light outlining the vehicle, animated city traffic far below, sense of speed with motion blur and parallax, cinematic high-contrast lighting, ultra-detailed, photoreal, 35mm anamorphic, shallow depth of field, film grain, 4K.",
        },
        {
          role: "user",
          content: "Option 2, go",
        },
        {
          role: "assistant",
          content:
            "How long should the video be (4s, 6s, or 8s), and what aspect ratio do you want (16:9, 9:16, or 1:1)?\n\nIf you don’t care, I’ll do **6s, 16:9**.",
        },
        {
          role: "user",
          content: "yes, go",
        },
      ];

      const result = routeUserIntent(conversation, registry);

      expect(result.intent).toBe("media_video");
      expect(result.toolsToActivate).toContain("media_video_generate");
      expect(registry.getActiveToolNames()).toContain("media_video_generate");
      expect(result.extractedParameters?.prompt).toContain(
        "Cyberpunk hovercar chase, soaring between towering neon-lit skyscrapers",
      );
      expect(result.extractedParameters?.duration_seconds).toBeGreaterThanOrEqual(2);
      expect(result.extractedParameters?.width).toBe(832);
      expect(result.extractedParameters?.height).toBe(480);
      expect(result.systemGuidance).toContain("media_video_generate");
    });

    it("does NOT launch media generation on an unrelated 'ok' or 'yes' when no pending proposal exists", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const conversation: ChatMessage[] = [
        {
          role: "user",
          content: "What is the capital of France?",
        },
        {
          role: "assistant",
          content: "The capital of France is Paris.",
        },
        {
          role: "user",
          content: "ok, thanks",
        },
      ];

      const result = routeUserIntent(conversation, registry);

      expect(result.intent).toBe("conversation");
      expect(result.toolsToActivate).toHaveLength(0);
      expect(registry.getActiveToolNames()).not.toContain("media_video_generate");
      expect(registry.getActiveToolNames()).not.toContain("media_image_generate");
      expect(registry.getActiveToolNames()).not.toContain("execute_shell");
    });

    it("does NOT trigger media generation when user confirms a workspace/coding request even if earlier turns had media", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const conversation: ChatMessage[] = [
        {
          role: "user",
          content: "Can you create a prompt for a video of an eagle soaring?",
        },
        {
          role: "assistant",
          content: "Here is a prompt: A majestic golden eagle soaring high above mountain peaks.",
        },
        {
          role: "user",
          content:
            "List the workspace directory structure and check the git commit status using the shell terminal.",
        },
        {
          role: "assistant",
          content:
            "Please confirm which path you want me to check: current workspace root, or a specific repo?",
        },
        {
          role: "user",
          content: "current workspace root, go ahead",
        },
      ];

      const result = routeUserIntent(conversation, registry);

      expect(result.intent).not.toBe("media_video");
      expect(result.intent).not.toBe("media_image");
      expect(registry.getActiveToolNames()).not.toContain("media_video_generate");
      expect(registry.getActiveToolNames()).not.toContain("media_image_generate");
    });
  });
});

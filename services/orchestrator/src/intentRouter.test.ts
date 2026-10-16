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
  });
});

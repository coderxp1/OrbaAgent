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

    it("leaves media tools inactive for general coding or engineering requests", () => {
      const registry = new ToolRegistry();
      registry.resetActiveToolsToCore();

      const generalPrompts = [
        "Fix the unit tests in services/orchestrator/src/orchestrator.test.ts",
        "Refactor the authentication middleware to use JWT tokens",
        "Run git status and show me what changed",
        "Install the new dependency with pnpm add",
      ];

      for (const prompt of generalPrompts) {
        registry.resetActiveToolsToCore();
        const result = routeUserIntent([{ role: "user", content: prompt }], registry);
        expect(result.intent).toBe("general_coding");
        expect(result.toolsToActivate).toHaveLength(0);
        expect(registry.getActiveToolNames()).not.toContain("media_image_generate");
        expect(registry.getActiveToolNames()).not.toContain("media_video_generate");
      }
    });
  });
});

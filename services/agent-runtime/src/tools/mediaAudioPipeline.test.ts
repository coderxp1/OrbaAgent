import { describe, expect, it } from "vitest";
import {
  detectSceneAudioProfile,
  extractVoiceNarrationText,
  isExplicitlySilent,
} from "./mediaAudioPipeline.js";

describe("mediaAudioPipeline", () => {
  describe("extractVoiceNarrationText — spoken-sentence extraction", () => {
    it("extracts the sentence from the incident phrasing 'I want her to say on the video : ...'", () => {
      // Regression (2026-10-21): this exact user phrasing previously
      // extracted nothing — "say" was not a recognized dialogue verb and
      // there were no quotes — so no voice was ever attempted.
      const narration = extractVoiceNarrationText(
        "Generate a vertical video with this photo, do not change my photo when generating the video, I want her to say on the video : I love you Jan Paul",
      );
      expect(narration.text).toBe("I love you Jan Paul");
      expect(narration.lang).toBe("en");
    });

    it("extracts quoted dialogue", () => {
      const narration = extractVoiceNarrationText('Have her say: "I love you, Jan Paul."');
      expect(narration.text).toBe("I love you, Jan Paul.");
    });

    it("extracts 'says <sentence>' phrasing", () => {
      const narration = extractVoiceNarrationText("The woman says welcome to our store");
      expect(narration.text).toBe("welcome to our store");
    });
  });

  describe("isExplicitlySilent", () => {
    it("detects silent requests in prompt", () => {
      expect(isExplicitlySilent("Generate a silent video of a dog")).toBe(true);
      expect(isExplicitlySilent("create a video with no audio")).toBe(true);
      expect(isExplicitlySilent("un video sin sonido")).toBe(true);
      expect(isExplicitlySilent("make a muted video clip")).toBe(true);
    });

    it("detects explicit silent arguments", () => {
      expect(isExplicitlySilent("a dog running", { silent: true })).toBe(true);
      expect(isExplicitlySilent("a dog running", { audio: false })).toBe(true);
    });

    it("returns false for standard video requests", () => {
      expect(isExplicitlySilent("Generate a video of 10 seconds of Jesus healing the sick")).toBe(false);
      expect(isExplicitlySilent("ocean waves on a tropical beach")).toBe(false);
    });
  });

  describe("detectSceneAudioProfile", () => {
    it("accurately detects sacred/spiritual scenes", () => {
      const profile = detectSceneAudioProfile("Generate a video of 10 seconds of Jesus healing the sick");
      expect(profile.name).toBe("sacred_spiritual");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });

    it("accurately detects ocean/water scenes", () => {
      const profile = detectSceneAudioProfile("drone shot over ocean waves crashing on rocky beach");
      expect(profile.name).toBe("water_ocean");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });

    it("accurately detects nature scenes", () => {
      const profile = detectSceneAudioProfile("a white rabbit in a meadow full of flowers");
      expect(profile.name).toBe("nature_outdoors");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });

    it("accurately detects urban/city scenes", () => {
      const profile = detectSceneAudioProfile("night street in Tokyo with glowing neon signs and cars");
      expect(profile.name).toBe("city_urban");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });

    it("accurately detects commercial/tech scenes", () => {
      const profile = detectSceneAudioProfile("modern SaaS app commercial showing AI productivity software");
      expect(profile.name).toBe("commercial_tech");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });

    it("provides balanced cinematic fallback for general prompts", () => {
      const profile = detectSceneAudioProfile("an antique clock ticking on an old wooden table");
      expect(profile.name).toBe("peaceful_cinematic");
      expect(profile.ambienceFilter).toBeDefined();
      expect(profile.musicExpr).toBeDefined();
    });
  });
});

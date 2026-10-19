import { describe, expect, it } from "vitest";
import { GITHUB_STATE_COOKIE, statesMatch } from "./oauth-state";

describe("OAuth state binding", () => {
  it("exposes a stable cookie name", () => {
    expect(GITHUB_STATE_COOKIE).toBe("orba_github_state");
  });

  it("accepts only an exact match", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
  });

  it("rejects a missing value on either side", () => {
    expect(statesMatch(null, "abc")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

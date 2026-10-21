import { describe, expect, it } from "vitest";
import {
  canonicalArtifactUrl,
  decodeArtifactId,
  resolveAttachmentArtifactUrl,
} from "./artifacts.js";

const id = Buffer.from(JSON.stringify({ w: "tenant-1", b: "bundle-9", p: "photo.jpg" })).toString(
  "base64url",
);

describe("artifactId decoding and canonical URLs", () => {
  it("decodes a server-issued artifactId", () => {
    expect(decodeArtifactId(id)).toEqual({ w: "tenant-1", b: "bundle-9", p: "photo.jpg" });
  });

  it("builds the canonical URL with per-segment encoding", () => {
    expect(canonicalArtifactUrl(id)).toBe("/api/artifacts/tenant-1/bundle-9/photo.jpg");
    const spaced = Buffer.from(JSON.stringify({ w: "t 1", b: "b", p: "my photo.jpg" })).toString(
      "base64url",
    );
    expect(canonicalArtifactUrl(spaced)).toBe("/api/artifacts/t%201/b/my%20photo.jpg");
  });

  it("rejects non-artifactId values", () => {
    expect(decodeArtifactId("photo.jpg")).toBeNull();
    expect(decodeArtifactId("")).toBeNull();
    expect(decodeArtifactId(undefined)).toBeNull();
    expect(canonicalArtifactUrl("not-an-id")).toBeNull();
  });
});

describe("resolveAttachmentArtifactUrl", () => {
  it("passes through a direct artifact URL", () => {
    expect(resolveAttachmentArtifactUrl({ url: "/api/artifacts/t/b/photo.jpg" })).toBe(
      "/api/artifacts/t/b/photo.jpg",
    );
  });

  it("derives the canonical URL from an artifactId — never a hardcoded tenant", () => {
    expect(resolveAttachmentArtifactUrl({ artifactId: id })).toBe(
      "/api/artifacts/tenant-1/bundle-9/photo.jpg",
    );
  });

  it("ignores previewUrl and bare filenames (no low-res or guessed references)", () => {
    expect(
      resolveAttachmentArtifactUrl({ previewUrl: "https://x/preview.jpg" } as any),
    ).toBeUndefined();
    expect(resolveAttachmentArtifactUrl({ name: "photo.jpg" } as any)).toBeUndefined();
  });

  it("prefers the canonical URL over a preview when both exist", () => {
    expect(
      resolveAttachmentArtifactUrl({ url: "/api/artifacts/t/b/photo.jpg", previewUrl: "p" } as any),
    ).toBe("/api/artifacts/t/b/photo.jpg");
  });
});

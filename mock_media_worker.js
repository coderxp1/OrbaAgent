const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const app = express();
app.use(express.json());

const AUTH_TOKEN = "test-token";

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", auth, (req, res) => {
  res.json({
    worker: "healthy",
    status: "ok",
    capabilities: {
      image_generation: true,
      video_generation: true,
      media_processing: true,
    },
    generation_backend: "diffusers",
    models: [],
    active_generations: 0,
    max_concurrent_generations: 1,
  });
});

app.post("/api/generate/image", auth, (req, res) => {
  const { prompt, width, height } = req.body;
  console.log("Generating image for prompt:", prompt);

  // Create a dummy image or return a static image URL
  // We can just return a public placeholder image for verification
  const jobId = `job_${Date.now()}`;
  const artifactUrl = `https://via.placeholder.com/${width || 1024}x${height || 1024}.png?text=${encodeURIComponent(prompt.substring(0, 50))}`;

  setTimeout(() => {
    res.json({
      jobId,
      status: "COMPLETED",
      artifact_id: `art_${Date.now()}`,
      artifactUrl,
      artifactPath: `/output/${jobId}.png`,
      content_type: "image/png",
      size_bytes: 1024,
      sha256: crypto.createHash("sha256").update(artifactUrl).digest("hex"),
      model: "flux1-schnell",
      durationMs: 1500,
      delivered_to_production: true,
    });
  }, 1500);
});

app.post("/api/generate/video", auth, (req, res) => {
  const { prompt, duration_seconds } = req.body;
  console.log("Generating video for prompt:", prompt);

  const jobId = `job_${Date.now()}`;
  // Big Buck Bunny for sample video
  const artifactUrl =
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

  setTimeout(() => {
    res.json({
      jobId,
      status: "COMPLETED",
      artifact_id: `art_${Date.now()}`,
      artifactUrl,
      artifactPath: `/output/${jobId}.mp4`,
      content_type: "video/mp4",
      size_bytes: 5242880,
      sha256: crypto.createHash("sha256").update(artifactUrl).digest("hex"),
      model: "wan2.1-t2v-1.3b",
      durationMs: 3000,
      delivered_to_production: true,
    });
  }, 3000);
});

app.listen(8190, "127.0.0.1", () => {
  console.log("Mock media worker listening on http://127.0.0.1:8190");
});

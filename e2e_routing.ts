import fs from "node:fs";
import type { ChatCompletionRequest } from "@orbaagent/shared";
import { ModelGateway } from "./services/model-gateway/src/gateway.js";

async function runTests() {
  console.log("Starting OrbaAgent Intelligence Fabric Integration Tests...");

  process.env.OLLAMA_BASE_URL = "http://10.77.0.2:11435";
  process.env.OLLAMA_ENABLED = "true";
  process.env.ALLOW_MOCK_PROVIDERS = "true"; // Required because without credentials, Langdock failover aborts otherwise

  const gateway = new ModelGateway();

  // Test 1: Coding Task
  const reqCode: ChatCompletionRequest = {
    messages: [
      {
        role: "user",
        content: "Write a short bash script to echo Hello World. Keep it very brief.",
      },
    ],
    modelId: "auto",
    stream: false,
    trace: {
      traceId: "t1",
      tenantId: "test",
      userId: "test",
      conversationId: "c1",
      agentRunId: "r1",
    },
  };

  console.log("\n--- 1. Submit a coding task ---");
  let start = Date.now();
  let decision = gateway.router.selectRouting(reqCode);
  console.log(
    `Router Decision: Selected ${decision.primaryModel.provider}/${decision.primaryModel.id}`,
  );
  try {
    const res = await gateway.chat(reqCode);
    console.log(`Latency: ${Date.now() - start}ms`);
    console.log(`Result content: ${res.content.replace(/\n/g, " ").substring(0, 100)}...`);
  } catch (err) {
    console.error("Test 1 Failed:", err);
  }

  // Test 2: Vision Task with REAL image
  console.log("\n--- 2. Submit an image-understanding task with a small 1x1 image ---");
  // 1x1 GIF base64
  const b64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const reqVision: ChatCompletionRequest = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this image?" },
          { type: "image_url", image_url: { url: `data:image/gif;base64,${b64}` } },
        ],
      },
    ],
    modelId: "auto",
    stream: false,
    trace: {
      traceId: "t2",
      tenantId: "test",
      userId: "test",
      conversationId: "c2",
      agentRunId: "r2",
    },
  };
  decision = gateway.router.selectRouting(reqVision);
  console.log(
    `Router Auto Decision: Selected ${decision.primaryModel.provider}/${decision.primaryModel.id}`,
  );
  start = Date.now();
  try {
    const res = await gateway.chat(reqVision);
    console.log(`Latency: ${Date.now() - start}ms`);
    console.log(`Result content: ${res.content.replace(/\n/g, " ").substring(0, 100)}...`);
  } catch (err) {
    console.error("Test 2 Failed:", err);
  }

  // Test 3: General Text Task
  const reqGeneral: ChatCompletionRequest = {
    messages: [
      {
        role: "user",
        content: "Who was the 16th president of the United States? Reply with only the name.",
      },
    ],
    modelId: "auto",
    stream: false,
    trace: {
      traceId: "t3",
      tenantId: "test",
      userId: "test",
      conversationId: "c3",
      agentRunId: "r3",
    },
  };

  console.log("\n--- 3. Submit a general text task ---");
  start = Date.now();
  decision = gateway.router.selectRouting(reqGeneral);
  console.log(
    `Router Decision: Selected ${decision.primaryModel.provider}/${decision.primaryModel.id}`,
  );
  try {
    const res = await gateway.chat(reqGeneral);
    console.log(`Latency: ${Date.now() - start}ms`);
    console.log(`Result content: ${res.content.replace(/\n/g, " ").substring(0, 100)}...`);
  } catch (err) {
    console.error("Test 3 Failed:", err);
  }
}

runTests().catch(console.error);

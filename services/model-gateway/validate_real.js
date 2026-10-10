import { ModelGateway } from "./dist/gateway.js";
import fs from "node:fs";

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function validate() {
  console.log("Starting Real Application Behavior Validation...");

  // Force enable Ollama with the actual private endpoint (via local SSH tunnel)
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11435";
  process.env.OLLAMA_ENABLED = "true";
  process.env.ALLOW_MOCK_PROVIDERS = "false"; // Disable mocks to ensure we hit the real APIs!

  const gateway = new ModelGateway();

  try {
    // 1. Coding Request
    console.log("\n[TEST 1] Coding request");
    const reqCode = {
      messages: [{ role: "user", content: "Write a short bash script to echo Hello World." }],
      modelId: "auto",
      stream: false,
      trace: { traceId: "v1", tenantId: "test", userId: "test", conversationId: "v1", agentRunId: "v1" }
    };
    
    let decision;
    try {
      decision = gateway.router.selectRouting(reqCode);
      console.log(`Decision for coding task: Provider=${decision.primaryModel.provider}, Model=${decision.primaryModel.id}, Reason=${decision.reason}`);
    } catch (e) {
      console.log("Failed to select routing:", e);
      throw e;
    }
    
    let start = Date.now();
    let response = await gateway.chat(reqCode);
    console.log(`Latency: ${Date.now() - start}ms | Output (excerpt): ${response.text.substring(0, 80).replace(/\n/g, " ")}`);

    // 2. Vision Request
    console.log("\n[TEST 2] Image-understanding request");
    const reqVision = {
      messages: [{ role: "user", content: "Describe the image briefly." }],
      modelId: "orba-vision-engine",
      stream: false,
      trace: { traceId: "v2", tenantId: "test", userId: "test", conversationId: "v2", agentRunId: "v2" }
    };
    decision = gateway.router.selectRouting(reqVision);
    console.log(`Decision for explicit vision task: Provider=${decision.primaryModel.provider}, Model=${decision.primaryModel.id}, Reason=${decision.reason}`);
    
    start = Date.now();
    response = await gateway.chat(reqVision);
    console.log(`Latency: ${Date.now() - start}ms | Output (excerpt): ${response.text.substring(0, 80).replace(/\n/g, " ")}`);

    // 3. Combined Request
    console.log("\n[TEST 3] Combined image-plus-coding request");
    
    // Using a valid image downloaded dynamically to avoid base64/tensor crash
    const fetchImg = await fetch("https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg");
    const imgBuf = await fetchImg.arrayBuffer();
    const b64 = Buffer.from(imgBuf).toString("base64");

    const reqCombined = {
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: "text", text: "Describe this image." }
      ] }],
      modelId: "auto",
      stream: false,
      trace: { traceId: "v3", tenantId: "test", userId: "test", conversationId: "v3", agentRunId: "v3" }
    };
    decision = gateway.router.selectRouting(reqCombined);
    console.log(`Decision for combined task: Provider=${decision.primaryModel.provider}, Model=${decision.primaryModel.id}, Reason=${decision.reason}`);
    start = Date.now();
    response = await gateway.chat(reqCombined);
    console.log(`Latency: ${Date.now() - start}ms | Output (excerpt): ${response.text.substring(0, 80).replace(/\n/g, " ")}`);

    // 4. General Text Request
    console.log("\n[TEST 4] General text request");
    const reqGeneral = {
      messages: [{ role: "user", content: "What is the capital of France?" }],
      modelId: "auto",
      stream: false,
      trace: { traceId: "v4", tenantId: "test", userId: "test", conversationId: "v4", agentRunId: "v4" }
    };
    decision = gateway.router.selectRouting(reqGeneral);
    console.log(`Decision for general text task: Provider=${decision.primaryModel.provider}, Model=${decision.primaryModel.id}, Reason=${decision.reason}`);

    // 5. Local Ollama Unavailable
    console.log("\n[TEST 5] Local Ollama unavailable fallback");
    console.log("Simulating circuit breaker trip for Ollama...");
    gateway.router.recordProviderFailure("ollama");
    gateway.router.recordProviderFailure("ollama");
    gateway.router.recordProviderFailure("ollama");
    
    try {
      decision = gateway.router.selectRouting(reqCode);
      console.log(`Fallback Decision for coding task: Provider=${decision.primaryModel.provider}, Model=${decision.primaryModel.id}, Reason=${decision.reason}`);
    } catch (e) {
      console.log(`Fallback failed/prevented: ${e.message}`);
    }

  } catch (err) {
    console.error("Validation Error:", err);
  }
}

validate().catch(console.error);

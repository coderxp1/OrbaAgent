import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.TEST_BASE_URL || "https://orbaagent.dev";

async function uploadFiles(filePaths) {
  const formData = new FormData();
  const bundle = `test_bundle_${Date.now()}`;
  formData.set("bundle", bundle);

  for (const fp of filePaths) {
    const fileBuf = fs.readFileSync(fp);
    const fileName = path.basename(fp);
    const blob = new Blob([fileBuf]);
    formData.append("files", blob, fileName);
  }

  const res = await fetch(`${BASE_URL}/api/uploads`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.artifacts || []).map((a, i) => ({
    artifactId: a.id,
    name: a.name,
    type: a.type,
    size: a.size,
    relPath: a.relPath,
    url: a.url,
  }));
}

async function sendChat(message, attachments = []) {
  const payload = {
    modelId: "auto",
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
    stream: true,
    attachments: attachments.map((a) => ({
      artifactId: a.artifactId,
      name: a.name,
      type: a.type,
      size: a.size,
      relPath: a.relPath,
      url: a.url,
    })),
    trace: {
      traceId: `trace_test_${Date.now()}`,
      tenantId: "default-tenant",
      userId: "default-user",
      conversationId: `conv_test_${Date.now()}`,
      agentRunId: `run_test_${Date.now()}`,
    },
  };

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat API error HTTP ${res.status}: ${text}`);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          events.push(parsed);
          if (parsed.textDelta) fullText += parsed.textDelta;
          if (parsed.error) fullText += `\n[ERROR: ${parsed.error}]`;
        } catch {}
      }
    }
  }

  return { fullText, events };
}

async function runAcceptanceSuite() {
  console.log(`=== STARTING ORBAAGENT ACCEPTANCE SUITE against ${BASE_URL} ===\n`);
  const results = {};

  // Test 1: Image Understanding (Logo)
  console.log("--- TEST 1: Image Understanding (acme_logo.png) ---");
  try {
    const logoAtts = await uploadFiles([path.resolve("scratch_tests/acme_logo.png")]);
    console.log("Uploaded logo artifact:", logoAtts[0]);

    const chatRes = await sendChat("What colors and shapes are in this attached image?", logoAtts);
    console.log("Response:", chatRes.fullText.slice(0, 300));
    const mentionsBlue = /blue/i.test(chatRes.fullText);
    const mentionsWhite = /white/i.test(chatRes.fullText);
    const mentionsSquare = /square|box|rectangle|geometric/i.test(chatRes.fullText);
    const noError = !/\[image_read_error\]/i.test(chatRes.fullText);

    results.test1_image_understanding = {
      pass: noError && (mentionsBlue || mentionsWhite || mentionsSquare),
      mentionsBlue,
      mentionsWhite,
      mentionsSquare,
      noError,
      responseSample: chatRes.fullText.slice(0, 150),
    };
  } catch (err) {
    results.test1_image_understanding = { pass: false, error: err.message };
  }
  console.log("Result:", results.test1_image_understanding);

  // Test 2: Document Reading (TXT)
  console.log("\n--- TEST 2: Document Reading (company_secret.txt) ---");
  try {
    const txtAtts = await uploadFiles([path.resolve("scratch_tests/company_secret.txt")]);
    const chatRes = await sendChat(
      "Based on the attached document, what was the Q3 Revenue and lead product code?",
      txtAtts,
    );
    console.log("Response:", chatRes.fullText);
    const mentionsRevenue = /42\.8/i.test(chatRes.fullText);
    const mentionsProduct = /CyberShield-X9/i.test(chatRes.fullText);

    results.test2_document_txt = {
      pass: mentionsRevenue && mentionsProduct,
      mentionsRevenue,
      mentionsProduct,
      responseSample: chatRes.fullText.slice(0, 150),
    };
  } catch (err) {
    results.test2_document_txt = { pass: false, error: err.message };
  }
  console.log("Result:", results.test2_document_txt);

  // Test 3: Document Reading (PDF)
  console.log("\n--- TEST 3: Document Reading (quarterly_brief.pdf) ---");
  try {
    const pdfAtts = await uploadFiles([path.resolve("scratch_tests/quarterly_brief.pdf")]);
    const chatRes = await sendChat(
      "What is the launch date of Project Falcon mentioned in the attached PDF?",
      pdfAtts,
    );
    console.log("Response:", chatRes.fullText);
    const mentionsDate = /November 15/i.test(chatRes.fullText);

    results.test3_document_pdf = {
      pass: mentionsDate,
      mentionsDate,
      responseSample: chatRes.fullText.slice(0, 150),
    };
  } catch (err) {
    results.test3_document_pdf = { pass: false, error: err.message };
  }
  console.log("Result:", results.test3_document_pdf);

  // Test 4: Multiple Files (CSV + TXT)
  console.log("\n--- TEST 4: Multiple Files Upload & Selective Reasoning ---");
  try {
    const multiAtts = await uploadFiles([
      path.resolve("scratch_tests/products.csv"),
      path.resolve("scratch_tests/company_secret.txt"),
    ]);
    const chatRes = await sendChat(
      "From products.csv, what is the revenue for QuantumProcessor? And from the report, what is the gross margin?",
      multiAtts,
    );
    console.log("Response:", chatRes.fullText);
    const mentionsQP = /15\.4/i.test(chatRes.fullText);
    const mentionsMargin = /84%/i.test(chatRes.fullText);

    results.test4_multiple_files = {
      pass: mentionsQP && mentionsMargin,
      mentionsQP,
      mentionsMargin,
      responseSample: chatRes.fullText.slice(0, 150),
    };
  } catch (err) {
    results.test4_multiple_files = { pass: false, error: err.message };
  }
  console.log("Result:", results.test4_multiple_files);

  // Test 5: Corrupt File Error Handling
  console.log("\n--- TEST 5: Corrupt Document Handling ---");
  try {
    const corruptAtts = await uploadFiles([path.resolve("scratch_tests/corrupt_document.pdf")]);
    const chatRes = await sendChat("Summarize the attached PDF file.", corruptAtts);
    console.log("Response:", chatRes.fullText);
    const handlesGracefully =
      /corrupt|unsupported|unable to extract|invalid|could not read/i.test(chatRes.fullText) &&
      !/Project Falcon|November 15/i.test(chatRes.fullText);

    results.test5_corrupt_file = {
      pass: handlesGracefully,
      responseSample: chatRes.fullText.slice(0, 150),
    };
  } catch (err) {
    results.test5_corrupt_file = { pass: false, error: err.message };
  }
  console.log("Result:", results.test5_corrupt_file);

  // Test 6: Commercial Generation with Logo (15 seconds)
  console.log("\n--- TEST 6: 15-Second Commercial Generation with Logo ---");
  try {
    const logoAtts = await uploadFiles([path.resolve("scratch_tests/acme_logo.png")]);
    console.log("Uploaded logo for commercial:", logoAtts[0]);

    const chatRes = await sendChat(
      "Generate a viral commercial with this logo that is attached.",
      logoAtts,
    );
    console.log("Response text:", chatRes.fullText);

    // Look for video URL in events or response text
    let videoUrl = null;
    for (const ev of chatRes.events) {
      if (ev.toolResult?.result?.video_url) {
        videoUrl = ev.toolResult.result.video_url;
        break;
      }
      if (ev.toolResult?.result?.artifacts?.[0]?.url) {
        videoUrl = ev.toolResult.result.artifacts[0].url;
        break;
      }
    }
    if (!videoUrl) {
      const match =
        chatRes.fullText.match(/https?:\/\/[^\s\)]+\.mp4/i) ||
        chatRes.fullText.match(/\/api\/artifacts\/[^\s\)]+\.mp4/i);
      if (match) videoUrl = match[0];
    }

    console.log("Found video URL:", videoUrl);
    results.test6_commercial_video = {
      pass: !!videoUrl,
      videoUrl,
      responseSample: chatRes.fullText.slice(0, 200),
    };

    if (videoUrl) {
      const fullVideoUrl = videoUrl.startsWith("http") ? videoUrl : `${BASE_URL}${videoUrl}`;
      console.log("Checking video duration with ffprobe for:", fullVideoUrl);
      try {
        const ffprobeOut = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullVideoUrl}"`,
          { timeout: 30000 },
        )
          .toString()
          .trim();
        const durationSec = Number.parseFloat(ffprobeOut);
        console.log(`Measured ffprobe duration: ${durationSec}s`);
        results.test6_commercial_video.measuredDuration = durationSec;
        results.test6_commercial_video.durationGte15 = durationSec >= 14.5;
        results.test6_commercial_video.pass = durationSec >= 14.5;
      } catch (e) {
        console.warn("ffprobe error or not available locally:", e.message);
      }
    }
  } catch (err) {
    results.test6_commercial_video = { pass: false, error: err.message };
  }
  console.log("Result:", results.test6_commercial_video);

  // Test 7: Confidentiality Audit
  console.log("\n--- TEST 7: Confidentiality Audit ---");
  const allText = JSON.stringify(results);
  const leakedGpu = /GPU\s*\d+/i.test(allText);
  const leakedWan = /Wan\s*2/i.test(allText);
  const leakedFlux = /FLUX/i.test(allText);
  results.test7_confidentiality = {
    pass: !leakedGpu && !leakedWan && !leakedFlux,
    leakedGpu,
    leakedWan,
    leakedFlux,
  };
  console.log("Result:", results.test7_confidentiality);

  fs.writeFileSync(
    path.resolve("scratch_tests/acceptance_results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("\n=== Acceptance Suite Completed ===");
}

runAcceptanceSuite().catch(console.error);

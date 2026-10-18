import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { AgentOrchestrator } from "@orbaagent/orchestrator";
import type { ChatCompletionRequest } from "@orbaagent/shared";
import { cookies } from "next/headers";

// Shared orchestrator instance inside server runtime
const orchestrator = new AgentOrchestrator();

export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatCompletionRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return Response.json({ error: "Missing messages array" }, { status: 400 });
    }

    const traceId =
      body.trace?.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Server-side verified context
    const verifiedTenantId = process.env.ORBA_TENANT_ID || "default-tenant";
    const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";

    // Read GitHub token from cookie, header, or environment
    let githubToken: string | undefined;
    try {
      const cookieStore = await cookies();
      githubToken = cookieStore.get("orba_github_token")?.value;
    } catch {}

    if (!githubToken) {
      githubToken =
        request.headers.get("x-github-token") ||
        (body.trace as { githubToken?: string })?.githubToken ||
        process.env.GITHUB_TOKEN;
    }

    if (githubToken) {
      process.env.GITHUB_TOKEN = githubToken;
      const manager = IntegrationsManager.getInstance();
      const current = manager.getIntegrations(verifiedUserId).find((i) => i.name === "github");
      manager.setIntegrationStatus(verifiedUserId, {
        name: "github",
        displayName: "GitHub",
        connected: true,
        accountName: current?.accountName || "GitHub User",
        lastSyncedAt: new Date().toISOString(),
        scopes: ["repo", "read:user", "user:email"],
      });
    }

    const executionSessionId =
      body.trace?.executionSessionId ||
      `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Server-side multimodal hydration: if attachments contain images and user message hasn't embedded image_url, hydrate it from storage
    const rawAttachments = Array.isArray((body as any).attachments)
      ? (body as any).attachments
      : [];
    const hydratedMessages = [...body.messages];
    const lastUserIdx = hydratedMessages.map((m) => m.role).lastIndexOf("user");

    if (lastUserIdx >= 0 && rawAttachments.length > 0) {
      const lastUser = hydratedMessages[lastUserIdx];
      const hasImagePart =
        Array.isArray(lastUser.content) &&
        lastUser.content.some((p: any) => p.type === "image_url");

      if (!hasImagePart) {
        const imageParts: any[] = [];
        const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");

        for (const att of rawAttachments) {
          const isImage =
            att.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(att.name || "");

          if (isImage && att.artifactId) {
            try {
              const decoded = JSON.parse(
                Buffer.from(att.artifactId, "base64url").toString("utf-8"),
              );
              const appUrl = (
                process.env.NEXT_PUBLIC_API_URL ||
                process.env.ORBA_WEB_URL ||
                "https://orbaagent.dev"
              ).replace(/\/+$/, "");
              const artifactUrl = `${appUrl}/api/artifacts/${encodeURIComponent(decoded.w)}/${encodeURIComponent(decoded.b)}/${encodeURIComponent(decoded.p)}`;
              imageParts.push({
                type: "image_url",
                image_url: { url: artifactUrl },
              });
            } catch (err) {
              console.warn("[CHAT API] Failed to hydrate server image attachment:", err);
            }
          }
        }

        if (imageParts.length > 0) {
          const existingText =
            typeof lastUser.content === "string"
              ? lastUser.content
              : Array.isArray(lastUser.content)
                ? lastUser.content.map((p: any) => (p.type === "text" ? p.text : "")).join(" ")
                : "";
          hydratedMessages[lastUserIdx] = {
            ...lastUser,
            content: [{ type: "text", text: existingText }, ...imageParts],
          };
        }
      }
    }

    const fullRequest: ChatCompletionRequest = {
      ...body,
      messages: hydratedMessages,
      modelId: "auto", // Always enforce automatic intelligence routing
      trace: {
        traceId,
        tenantId: verifiedTenantId,
        userId: verifiedUserId,
        conversationId: body.trace?.conversationId || "default-conversation",
        agentRunId: body.trace?.agentRunId || `run_${Date.now()}`,
        githubToken,
        executionSessionId,
      },
      attachments: rawAttachments.length > 0 ? rawAttachments : undefined,
    };

    // Establish Server-Sent Events stream with buffering disabled for proxies
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // Send keepalive comment lines every 3 seconds to prevent proxy / browser timeout on long generations
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {}
        }, 3000);

        try {
          for await (const event of orchestrator.executeAgentLoop(fullRequest)) {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const errPayload = `data: ${JSON.stringify({
            type: "error",
            traceId,
            error: { code: "stream_error", message: msg, retryable: true },
          })}\n\n`;
          controller.enqueue(encoder.encode(errPayload));
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // Disable proxy buffering for SSE (Nginx/Traefik)
        "X-Accel-Buffering": "no",
        // Prevent Next/edge runtimes from attempting compression on streamed body
        "Content-Encoding": "identity",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

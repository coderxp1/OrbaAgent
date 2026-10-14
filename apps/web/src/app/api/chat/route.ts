import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { AgentOrchestrator } from "@orbaagent/orchestrator";
import type { ChatCompletionRequest } from "@orbaagent/shared";
import { cookies } from "next/headers";

// Shared orchestrator instance inside server runtime
const orchestrator = new AgentOrchestrator();

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

    const fullRequest: ChatCompletionRequest = {
      ...body,
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
      attachments: Array.isArray((body as any).attachments) ? (body as any).attachments : undefined,
    };

    // Establish Server-Sent Events stream with buffering disabled for proxies
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
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

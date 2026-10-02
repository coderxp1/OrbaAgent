import { ModelGateway } from "@orbaagent/model-gateway";
import type { ChatCompletionRequest } from "@orbaagent/shared";

// Shared gateway instance inside server runtime
const gateway = new ModelGateway();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatCompletionRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return Response.json({ error: "Missing messages array" }, { status: 400 });
    }

    const traceId =
      body.trace?.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Server-side verified context (prevents trusting unverified client-supplied tenant/user identities)
    const verifiedTenantId = process.env.ORBA_TENANT_ID || "authenticated-tenant";
    const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";

    const fullRequest: ChatCompletionRequest = {
      ...body,
      modelId: "auto", // Always enforce automatic intelligence routing
      trace: {
        traceId,
        tenantId: verifiedTenantId,
        userId: verifiedUserId,
        conversationId: body.trace?.conversationId || "default-conversation",
        agentRunId: body.trace?.agentRunId || `run_${Date.now()}`,
      },
    };

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of gateway.streamChat(fullRequest)) {
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
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

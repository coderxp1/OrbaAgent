import { ModelGateway } from "@orbaagent/model-gateway";
import type { ChatCompletionRequest } from "@orbaagent/shared";

// Shared gateway instance inside server runtime
const gateway = new ModelGateway();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatCompletionRequest;

    if (!body.modelId || !body.messages) {
      return Response.json({ error: "Missing modelId or messages" }, { status: 400 });
    }

    const traceId =
      body.trace?.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullRequest: ChatCompletionRequest = {
      ...body,
      trace: {
        traceId,
        tenantId: body.trace?.tenantId || "default-tenant",
        userId: body.trace?.userId || "default-user",
        conversationId: body.trace?.conversationId || "default-conversation",
        agentRunId: body.trace?.agentRunId || "default-run",
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

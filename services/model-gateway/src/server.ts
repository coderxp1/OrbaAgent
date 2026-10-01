import cors from "@fastify/cors";
import { ChatCompletionRequestSchema } from "@orbaagent/shared";
import Fastify from "fastify";
import { ModelGateway } from "./gateway.js";
import { listAvailableModels } from "./registry.js";

export function createModelGatewayServer(gateway = new ModelGateway()) {
  const server = Fastify({ logger: false });

  server.register(cors, { origin: "*" });

  server.get("/health", async () => {
    return { status: "ok", service: "model-gateway", timestamp: new Date().toISOString() };
  });

  server.get("/v1/models", async () => {
    return { models: listAvailableModels() };
  });

  server.get("/v1/audit/logs", async () => {
    return { logs: gateway.auditLogs };
  });

  server.post("/v1/chat/completions", async (request, reply) => {
    const parseResult = ChatCompletionRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid ChatCompletionRequest",
        details: parseResult.error.format(),
      });
    }

    const chatReq = parseResult.data;

    if (chatReq.stream) {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");

      for await (const event of gateway.streamChat(chatReq)) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      reply.raw.write("data: [DONE]\n\n");
      return reply.raw.end();
    }

    const response = await gateway.chat(chatReq);
    return reply.status(200).send(response);
  });

  return server;
}

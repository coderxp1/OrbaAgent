import cors from "@fastify/cors";
import { ChatCompletionRequestSchema } from "@orbaagent/shared";
import Fastify from "fastify";
import { ModelGateway } from "./gateway.js";
import { listAvailableModels } from "./registry.js";

export function createModelGatewayServer(gateway = new ModelGateway()) {
  const server = Fastify({ logger: false });

  // Configure strict CORS origin controls
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ||
    "http://localhost:3000,https://orbaagent.dev,https://www.orbaagent.dev"
  )
    .split(",")
    .map((o) => o.trim());

  server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("CORS origin not allowed"), false);
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Authentication middleware for administrative and gateway endpoints
  const verifyAuth = (authHeader?: string): boolean => {
    const expectedToken = process.env.ORBA_ADMIN_TOKEN || process.env.ADMIN_API_KEY;
    if (process.env.NODE_ENV === "production" || expectedToken) {
      return Boolean(authHeader && authHeader === `Bearer ${expectedToken}`);
    }
    return true; // Allow local dev requests if no secret token configured
  };

  server.get("/health", async () => {
    return { status: "ok", service: "model-gateway", timestamp: new Date().toISOString() };
  });

  server.get("/v1/models", async (request, reply) => {
    if (!verifyAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized access to internal model registry" });
    }
    return { models: listAvailableModels() };
  });

  server.get("/v1/audit/logs", async (request, reply) => {
    if (!verifyAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized access to audit logs" });
    }
    return { logs: gateway.auditLogs };
  });

  server.post("/v1/chat/completions", async (request, reply) => {
    if (!verifyAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized access to model gateway" });
    }

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

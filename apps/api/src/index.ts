import { HealthResponseSchema } from "@orbaagent/shared";
import Fastify from "fastify";

const server = Fastify({
  logger: true,
});

server.get("/health", async (_request, reply) => {
  const payload = {
    status: "ok" as const,
    version: process.env.npm_package_version || "0.1.0",
    commitSha: process.env.COMMIT_SHA || "dev-local",
    timestamp: new Date().toISOString(),
  };

  const parsed = HealthResponseSchema.parse(payload);
  return reply.send(parsed);
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

export async function start() {
  try {
    await server.listen({ port, host });
    console.log(`OrbaAgent API listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  start();
}

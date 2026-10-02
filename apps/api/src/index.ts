import net from "node:net";
import { HealthResponseSchema } from "@orbaagent/shared";
import Fastify from "fastify";

const server = Fastify({
  logger: true,
});

// Configure CORS headers based on environment allowed origins
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,https://orbaagent.dev,https://www.orbaagent.dev"
)
  .split(",")
  .map((o) => o.trim());

server.addHook("onRequest", (request, reply, done) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  } else if (!origin) {
    // Same-origin or server-to-server request
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  if (request.method === "OPTIONS") {
    reply.status(204).send();
    return;
  }
  done();
});

function checkTcpReachability(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

function resolvePostgresTarget(): { host: string; port: number } {
  if (process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      return {
        host: parsed.hostname || "127.0.0.1",
        port: Number(parsed.port) || 5432,
      };
    } catch {
      // Fall through to env vars
    }
  }
  return {
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT) || 5432,
  };
}

function resolveRedisTarget(): { host: string; port: number } {
  if (process.env.REDIS_URL) {
    try {
      const parsed = new URL(process.env.REDIS_URL);
      return {
        host: parsed.hostname || "127.0.0.1",
        port: Number(parsed.port) || 6379,
      };
    } catch {
      // Fall through to env vars
    }
  }
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
  };
}

server.get("/health", async (_request, reply) => {
  const pgTarget = resolvePostgresTarget();
  const redisTarget = resolveRedisTarget();

  const [isPostgresUp, isRedisUp] = await Promise.all([
    checkTcpReachability(pgTarget.host, pgTarget.port),
    checkTcpReachability(redisTarget.host, redisTarget.port),
  ]);

  const isHealthy = isPostgresUp && isRedisUp;

  const payload = {
    status: isHealthy ? ("ok" as const) : ("error" as const),
    version: process.env.npm_package_version || "0.1.0",
    commitSha: process.env.COMMIT_SHA || "dev-local",
    uptime: Math.round(process.uptime() * 100) / 100,
    timestamp: new Date().toISOString(),
    checks: {
      postgres: isPostgresUp ? ("up" as const) : ("down" as const),
      redis: isRedisUp ? ("up" as const) : ("down" as const),
    },
  };

  const parsed = HealthResponseSchema.parse(payload);
  const statusCode = isHealthy ? 200 : 503;
  return reply.status(statusCode).send(parsed);
});

// Authenticated Gateway Audit Logs Endpoint
server.get("/v1/audit/logs", async (request, reply) => {
  const authHeader = request.headers.authorization;
  const expectedToken = process.env.ORBA_ADMIN_TOKEN || process.env.ADMIN_API_KEY;

  // In production, require strict authorization header matching
  if (process.env.NODE_ENV === "production" || expectedToken) {
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Missing or invalid administrative authorization token for audit logs",
      });
    }
  }

  return reply.status(200).send({
    status: "ok",
    auditLogs: [],
    message: "Audit logs require authenticated administrative access",
  });
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

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
    const langdockHealth = gateway.router.getProviderHealth("langdock");
    const openrouterHealth = gateway.router.getProviderHealth("openrouter");

    const langdockConfigured = gateway.router.isProviderConfigured("langdock");
    const openrouterConfigured = gateway.router.isProviderConfigured("openrouter");

    const allModels = listAvailableModels();
    const langdockModels = allModels.filter((m) => m.provider === "langdock");
    const openrouterModels = allModels.filter((m) => m.provider === "openrouter");

    const eligibleLangdock =
      langdockHealth.isHealthy && langdockHealth.isAuthenticated && langdockConfigured
        ? langdockModels.filter((m) => gateway.router.getModelFailures(m.id) < 3)
        : [];

    const eligibleOpenRouter =
      openrouterHealth.isHealthy && openrouterHealth.isAuthenticated && openrouterConfigured
        ? openrouterModels.filter((m) => gateway.router.getModelFailures(m.id) < 3)
        : [];

    const hasEligibleRoute = eligibleLangdock.length > 0 || eligibleOpenRouter.length > 0;

    return {
      status: hasEligibleRoute ? "ok" : "degraded",
      service: "model-gateway",
      timestamp: new Date().toISOString(),
      providers: {
        langdock: {
          reachable: langdockConfigured,
          authenticated: langdockHealth.isAuthenticated,
          isHealthy: langdockHealth.isHealthy,
          circuitBreakerOpen: !langdockHealth.isHealthy,
          modelsDiscovered: langdockModels.length,
          eligibleModels: eligibleLangdock.length,
          status: !langdockConfigured
            ? "UNCONFIGURED"
            : !langdockHealth.isAuthenticated
              ? "UNAUTHENTICATED"
              : !langdockHealth.isHealthy
                ? "CIRCUIT_OPEN"
                : eligibleLangdock.length > 0
                  ? "OPERATIONAL"
                  : "NO_ELIGIBLE_MODELS",
          reason: langdockHealth.authError || (langdockHealth.isHealthy ? "Active" : "Cooldown"),
        },
        openrouter: {
          reachable: openrouterConfigured,
          authenticated: openrouterHealth.isAuthenticated,
          isHealthy: openrouterHealth.isHealthy,
          circuitBreakerOpen: !openrouterHealth.isHealthy,
          modelsDiscovered: openrouterModels.length,
          eligibleModels: eligibleOpenRouter.length,
          status: !openrouterConfigured
            ? "UNCONFIGURED"
            : !openrouterHealth.isAuthenticated
              ? "UNAUTHENTICATED"
              : !openrouterHealth.isHealthy
                ? "CIRCUIT_OPEN"
                : eligibleOpenRouter.length > 0
                  ? "OPERATIONAL"
                  : "NO_ELIGIBLE_MODELS",
          reason:
            openrouterHealth.authError || (openrouterHealth.isHealthy ? "Active" : "Cooldown"),
        },
      },
    };
  });

  server.get("/health/models", async () => {
    const healthTracker = gateway.router.getHealthTracker();
    const records = healthTracker.getAllRecords();

    const langdockHealth = gateway.router.getProviderHealth("langdock");
    const openrouterHealth = gateway.router.getProviderHealth("openrouter");

    const langdockConfigured = gateway.router.isProviderConfigured("langdock");
    const openrouterConfigured = gateway.router.isProviderConfigured("openrouter");

    const modelDiagnostics = records.map((rec) => {
      const isProviderAuth =
        rec.provider === "langdock"
          ? langdockHealth.isAuthenticated && langdockConfigured
          : openrouterHealth.isAuthenticated && openrouterConfigured;

      const isProviderHealthy =
        rec.provider === "langdock" ? langdockHealth.isHealthy : openrouterHealth.isHealthy;

      const eligible = isProviderAuth && isProviderHealthy && rec.status === "AVAILABLE";
      const cooldownRemainingMs =
        rec.cooldownUntil && rec.cooldownUntil > Date.now() ? rec.cooldownUntil - Date.now() : 0;

      return {
        modelId: rec.modelId,
        displayName: rec.displayName,
        provider: rec.provider,
        status: rec.status,
        eligible,
        authenticated: isProviderAuth,
        failureCount: rec.failureCount,
        cooldownRemainingMs,
        lastFailureTime: rec.lastFailureTime
          ? new Date(rec.lastFailureTime).toISOString()
          : undefined,
        lastSuccessTime: rec.lastSuccessTime
          ? new Date(rec.lastSuccessTime).toISOString()
          : undefined,
        lastErrorType: rec.lastErrorType,
        latencyMs: rec.latency,
      };
    });

    return {
      timestamp: new Date().toISOString(),
      totalModels: modelDiagnostics.length,
      eligibleModelsCount: modelDiagnostics.filter((m) => m.eligible).length,
      models: modelDiagnostics,
    };
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

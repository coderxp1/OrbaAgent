import { ModelGateway } from "./gateway.js";
import { createModelGatewayServer } from "./server.js";

export * from "./adapters/base.js";
export * from "./adapters/langdock.js";
export * from "./adapters/openrouter.js";
export * from "./registry.js";
export * from "./router.js";
export * from "./gateway.js";
export * from "./server.js";

export function startGatewayServer(
  port = Number(process.env.PORT) || 3001,
  host = process.env.HOST || "0.0.0.0",
) {
  const server = createModelGatewayServer(new ModelGateway());
  return server.listen({ port, host }, (err: unknown, address: string) => {
    if (err) {
      console.error("Failed to start Model Gateway:", err);
      process.exit(1);
    }
    console.log(`OrbaAgent Model Gateway running on ${address}`);
  });
}

if (process.env.START_SERVER === "true") {
  startGatewayServer();
}

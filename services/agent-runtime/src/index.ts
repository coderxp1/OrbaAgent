export const SERVICE_NAME = "agent-runtime";

export async function run() {
  console.log(`Starting ${SERVICE_NAME}...`);
}

if (process.env.NODE_ENV !== "test") {
  run();
}

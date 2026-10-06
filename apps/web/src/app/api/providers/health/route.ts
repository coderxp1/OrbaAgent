import { getProvidersAuthStatus } from "@orbaagent/model-gateway";

export async function GET() {
  try {
    const status = await getProvidersAuthStatus();
    // Do not include any secrets; only booleans and counts
    return Response.json(status, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

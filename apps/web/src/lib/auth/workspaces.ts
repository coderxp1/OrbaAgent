import { isSafeFilename } from "@/lib/media";

/**
 * The workspaces this deployment serves.
 *
 * A tenant only exists here if the deployment says so, and there is exactly
 * one source of truth: the deployment's own workspace plus any additional
 * tenants declared in `ORBA_TENANTS`.
 *
 * Both the artifact ingest route and the session exchange consult this, so a
 * credential cannot mint a session for a tenant the deployment does not
 * serve, and a worker cannot ingest into one either.
 */
export function servedWorkspaces(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const deploymentWorkspace = (env.ORBA_TENANT_ID || "").trim() || "default-tenant";
  const served = new Set<string>([deploymentWorkspace]);
  for (const extra of (env.ORBA_TENANTS || "").split(",")) {
    const name = extra.trim();
    if (isSafeFilename(name)) served.add(name);
  }
  return served;
}

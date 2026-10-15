import { ChangeReviewManager } from "@orbaagent/agent-runtime";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentRunId = searchParams.get("agentRunId") || undefined;
    const manager = ChangeReviewManager.getInstance();
    const changes = manager.getChanges(agentRunId);
    return NextResponse.json({ success: true, changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: "accept" | "reject" | "accept_all" | "reject_all";
      changeId?: string;
      agentRunId?: string;
    };

    if (!body || !body.action) {
      return NextResponse.json({ error: "Missing action in request body" }, { status: 400 });
    }

    const manager = ChangeReviewManager.getInstance();
    let runId = body.agentRunId;

    if (!runId && body.changeId) {
      runId = manager.findRunIdByChangeId(body.changeId);
    }

    if (!runId && (body.action === "accept" || body.action === "reject")) {
      return NextResponse.json(
        { error: "Could not find agentRunId for the requested change" },
        { status: 404 },
      );
    }

    let success = false;

    const workspaceDir = process.env.ORBA_WORKSPACE_PATH || undefined;

    if (body.action === "accept" && body.changeId && runId) {
      success = manager.acceptChange(runId, body.changeId);
    } else if (body.action === "reject" && body.changeId && runId) {
      success = await manager.revertChange(runId, body.changeId, workspaceDir);
    } else if (body.action === "accept_all") {
      success = runId ? manager.acceptAll(runId) : true;
    } else if (body.action === "reject_all") {
      success = runId ? await manager.revertAll(runId, workspaceDir) : true;
    } else {
      return NextResponse.json({ error: "Invalid action or parameters" }, { status: 400 });
    }

    const changes = runId ? manager.getChanges(runId) : manager.getChanges();
    return NextResponse.json({ success, changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

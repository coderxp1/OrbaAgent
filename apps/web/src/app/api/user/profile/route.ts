import * as fs from "node:fs/promises";
import * as path from "node:path";
import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { type NextRequest, NextResponse } from "next/server";

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: "owner" | "admin" | "member";
  workspaceName: string;
  createdAt: string;
  updatedAt: string;
  preferences: {
    theme: string;
    modelTier: string;
    soundEnabled: boolean;
    autoSave: boolean;
  };
}

const PROFILE_FILE_PATH = path.join(
  process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads"),
  "user_profile.json",
);

async function getStoredProfile(userId: string): Promise<UserProfile> {
  try {
    const raw = await fs.readFile(PROFILE_FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    const defaultProfile: UserProfile = {
      id: userId,
      email: process.env.ORBA_USER_EMAIL || "hartmann@orbaagent.dev",
      displayName: "Hartmann",
      role: "owner",
      workspaceName: "Hartmann's Space",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: new Date().toISOString(),
      preferences: {
        theme: "dark",
        modelTier: "auto",
        soundEnabled: true,
        autoSave: true,
      },
    };
    return defaultProfile;
  }
}

export async function GET(req: Request) {
  const { identity, mode } = await resolveRequestIdentity(req);
  const unauthenticated = authorize(identity, mode, req);
  if (unauthenticated) return unauthenticated;
  const profile = await getStoredProfile(identity.userId);
  return NextResponse.json(profile);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identity, mode } = await resolveRequestIdentity(req);
    const unauthenticated = authorize(identity, mode, req);
    if (unauthenticated) return unauthenticated;
    const current = await getStoredProfile(identity.userId);

    const updated: UserProfile = {
      ...current,
      displayName:
        typeof body.displayName === "string" && body.displayName.trim()
          ? body.displayName.trim()
          : current.displayName,
      email:
        typeof body.email === "string" && body.email.trim() ? body.email.trim() : current.email,
      workspaceName:
        typeof body.workspaceName === "string" && body.workspaceName.trim()
          ? body.workspaceName.trim()
          : current.workspaceName,
      preferences: {
        ...current.preferences,
        ...(body.preferences || {}),
      },
      updatedAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(PROFILE_FILE_PATH), { recursive: true });
    await fs.writeFile(PROFILE_FILE_PATH, JSON.stringify(updated, null, 2), "utf-8");

    return NextResponse.json({ success: true, profile: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

import { type NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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

async function getStoredProfile(): Promise<UserProfile> {
  try {
    const raw = await fs.readFile(PROFILE_FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    const defaultProfile: UserProfile = {
      id: process.env.ORBA_USER_ID || "authenticated-user",
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

export async function GET() {
  const profile = await getStoredProfile();
  return NextResponse.json(profile);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const current = await getStoredProfile();

    const updated: UserProfile = {
      ...current,
      displayName: typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : current.displayName,
      email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : current.email,
      workspaceName: typeof body.workspaceName === "string" && body.workspaceName.trim() ? body.workspaceName.trim() : current.workspaceName,
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

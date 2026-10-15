import { handleGitHubCallback } from "../../github/callback/route";

export async function GET(request: Request) {
  return handleGitHubCallback(request);
}

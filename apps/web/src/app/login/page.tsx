"use client";

import { Bot, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Owner sign-in.
 *
 * Interim implementation: the operator exchanges their API credential for a
 * signed, HttpOnly session cookie. The credential is typed into a password
 * field, sent once over TLS, and never written to localStorage,
 * sessionStorage, a cookie, a URL or the console. It is dropped from component
 * state the moment the exchange succeeds.
 *
 * This is not a multi-user account system. It exists so the deployment can
 * require an authenticated caller before the real identity layer (ADR-004:
 * Better Auth + Drizzle) replaces it.
 */
export default function LoginPage() {
  const router = useRouter();
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // A valid session survives a page refresh, so land straight in the app
  // instead of asking for a credential that is already held.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user/profile", { cache: "no-store" });
        if (!cancelled && res.ok) {
          router.replace("/app");
          return;
        }
      } catch {
        // Network failure: fall through to the sign-in form.
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credential.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });

      if (res.status === 401) {
        setError("That credential was not accepted. Check it and try again.");
        return;
      }
      if (res.status === 403) {
        setError("This deployment does not serve the workspace for that credential.");
        return;
      }
      if (res.status === 503) {
        setError("Sessions are not enabled on this deployment yet.");
        return;
      }
      if (!res.ok) {
        setError("Sign-in failed. Please try again.");
        return;
      }

      // The credential is not retained anywhere: it leaves component state
      // here and the browser keeps only the HttpOnly session cookie.
      setCredential("");
      router.replace("/app");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-600 to-indigo-600 shadow-lg shadow-cyan-950/50">
            <Bot className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-2xl tracking-tight">Sign in to OrbaAgent</h1>
            <p className="mt-1 text-sm text-zinc-400">Enter your owner credential to continue.</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/40"
        >
          <label htmlFor="orba-credential" className="mb-2 block text-sm font-medium text-zinc-300">
            Access credential
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-zinc-500" />
            <input
              id="orba-credential"
              name="orba-credential"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              disabled={busy || checking}
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="Paste your access credential"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2.5 pr-3 pl-9 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-950 disabled:opacity-60"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            The credential is used once to create a session and is never stored by the browser.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-sm text-red-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || checking || !credential.trim()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
          <p>
            Interim single-owner sign-in. Sessions are signed, HttpOnly and scoped to your
            workspace; they expire after one hour. Multi-user accounts, roles and API keys are on
            the roadmap.
          </p>
        </div>
      </div>
    </main>
  );
}

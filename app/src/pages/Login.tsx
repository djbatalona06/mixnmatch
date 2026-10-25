// Sign in: ask for an email, or finish signing in with the link from that email.
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Notice } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../store/session";

export default function Login() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const load = useSession((s) => s.load);
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) return;
    // Already signed in? Go straight to Home.
    fetch("/api/me", { headers: { "X-Requested-With": "mixnmatch" } })
      .then((r) => r.ok && navigate("/dashboard", { replace: true }))
      .catch(() => {});
  }, [token, navigate]);

  async function confirm() {
    setConfirming(true);
    try {
      await api("/api/auth/verify", { method: "POST", body: { token } });
      await load();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setParams({}, { replace: true });
      setConfirming(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const result = await api<{ devLink?: string }>("/api/auth/request", { method: "POST", body: { email } });
      setSentTo(email);
      // Only happens when the server runs in DEV_MODE (local testing).
      setDevLink(result.devLink ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pt-6">
      {token ? (
        <Card className="space-y-4">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-muted">Tap below to finish signing in.</p>
          <Button variant="primary" size="big" className="w-full" id="confirm-btn" onClick={confirm} disabled={confirming}>
            Sign in to mix n match
          </Button>
        </Card>
      ) : (
        <Card className="space-y-4">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-muted">Type your email and we'll send you a one-tap sign-in link. No password needed.</p>
          <form onSubmit={send} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button variant="primary" size="big" type="submit" id="send" className="w-full" disabled={sending}>
              {sending ? "Sending…" : "Email me a link"}
            </Button>
          </form>
          {sentTo ? (
            <Notice tone="ok" role="status">
              Check your inbox at {sentTo}. The link works once and expires in 15 minutes.
            </Notice>
          ) : null}
          {devLink ? (
            <Notice tone="warn">
              Dev mode: no email is sent.{" "}
              <a href={devLink} id="dev-link-a" className="font-semibold text-accent underline" onClick={(e) => {
                e.preventDefault();
                const url = new URL(devLink);
                navigate(url.pathname + url.search);
              }}>
                Open your sign-in link
              </a>
            </Notice>
          ) : null}
        </Card>
      )}
      {error ? (
        <Notice tone="bad" role="alert" id="error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

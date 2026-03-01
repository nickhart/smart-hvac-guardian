import { useState } from "react";
import * as api from "../lib/api";

interface LoginFormProps {
  siteName: string;
  logoUrl?: string;
}

export function LoginForm({ siteName, logoUrl }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      await api.sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send login link");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        {logoUrl && <img src={logoUrl} alt={siteName} className="h-12 mx-auto mb-4" />}
        <h1 className="text-xl font-semibold mb-6 text-center">{siteName}</h1>

        {!sent ? (
          <form onSubmit={handleSend}>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="you@example.com"
              required
              autoFocus
            />
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full bg-primary-600 text-white rounded py-2 font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send login link"}
            </button>
          </form>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4 text-center">
              Check your email for a login link.
            </p>
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setError("");
              }}
              className="w-full bg-primary-600 text-white rounded py-2 font-medium hover:bg-primary-700"
            >
              Resend
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

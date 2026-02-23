import { useState } from "react";
import * as api from "../lib/api";

interface LoginFormProps {
  onLogin: (email: string, code: string) => Promise<void>;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      await api.sendOtp(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      await onLogin(email, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-6 text-center">HVAC Guardian</h1>

        {step === "email" ? (
          <form onSubmit={handleSendOtp}>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
              required
              autoFocus
            />
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send login code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <p className="text-sm text-gray-600 mb-4">Check your email for a 6-digit code.</p>
            <label className="block text-sm font-medium mb-1">Code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="000000"
              required
              autoFocus
            />
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              disabled={sending || code.length !== 6}
              className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
              className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import OttoLogo from "../../otto-logo";

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If GitHub redirected here with ?code=..., exchange code via backend fetch with ngrok-skip-browser-warning
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");
    if (code) {
      const apiUrl = (process.env.NEXT_PUBLIC_OTTO_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
      fetch(`${apiUrl}/auth/github/callback?code=${encodeURIComponent(code)}`, {
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "true",
        },
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          if (data.token) {
            sessionStorage.setItem("otto-token", data.token);
            sessionStorage.setItem("otto-email", data.email || "");
            sessionStorage.setItem("otto-name", data.name || "");
            sessionStorage.setItem("otto-avatar", data.avatar || "");
          }
          window.location.replace("/");
        })
        .catch((err) => {
          console.error("Auth callback failed:", err);
          setError(err.message || "Failed to complete GitHub authentication");
        });
      return;
    }

    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    const email = params.get("email") ?? "";
    const name = params.get("name") ?? email.split("@")[0];
    const avatar = params.get("avatar") ?? "";

    if (token) {
      sessionStorage.setItem("otto-token", token);
      sessionStorage.setItem("otto-email", email);
      sessionStorage.setItem("otto-name", name);
      sessionStorage.setItem("otto-avatar", avatar);
    }
    window.location.replace("/");
  }, []);

  if (error) {
    return (
      <div className="auth-loading" style={{ flexDirection: "column", gap: "16px", padding: "24px", textAlign: "center" }}>
        <OttoLogo className="h-7 w-auto" />
        <span style={{ color: "var(--ink)", maxWidth: "400px" }}>Authentication Error: {error}</span>
        <button
          onClick={() => window.location.replace("/")}
          style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", cursor: "pointer" }}
        >
          Return to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="auth-loading">
      <OttoLogo className="h-7 w-auto" />
      <span>Authenticating with GitHub...</span>
    </div>
  );
}

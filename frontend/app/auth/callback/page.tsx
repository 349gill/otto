"use client";
import { useEffect } from "react";
import OttoLogo from "../../otto-logo";

export default function AuthCallback() {
  useEffect(() => {
    // If GitHub redirected here with ?code=..., forward to backend callback
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");
    if (code) {
      const apiUrl = (process.env.NEXT_PUBLIC_OTTO_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
      window.location.replace(`${apiUrl}/auth/github/callback?code=${encodeURIComponent(code)}`);
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

  return (
    <div className="auth-loading">
      <OttoLogo className="h-7 w-auto" />
      <span>Authenticating with GitHub...</span>
    </div>
  );
}

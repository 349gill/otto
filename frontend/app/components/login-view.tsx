import OttoLogo from "../otto-logo";
import { GitHubIcon, MoonIcon, SunIcon } from "./icons";

type LoginViewProps = {
  theme: "light" | "dark";
  authError: string;
  onToggleTheme: () => void;
  onGitHubLogin: () => void;
};

export default function LoginView({
  theme,
  authError,
  onToggleTheme,
  onGitHubLogin,
}: LoginViewProps) {
  return (
    <div className="auth-screen" data-theme={theme}>
      <main className="auth-main" id="signin">
        <button
          className="auth-theme-toggle"
          onClick={onToggleTheme}
          aria-pressed={theme === "dark"}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? (
            <MoonIcon className="w-3.5 h-3.5" />
          ) : (
            <SunIcon className="w-3.5 h-3.5" />
          )}
        </button>
        <div className="auth-panel">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "28px" }}>
            <OttoLogo className="h-10 w-auto" />
          </div>

          {authError && <div className="form-error" role="alert">{authError}</div>}

          <button
            className="github-connect"
            type="button"
            style={{ width: "100%", height: "44px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
            onClick={onGitHubLogin}
          >
            <GitHubIcon className="w-4 h-4" />
            Sign in with GitHub
          </button>
        </div>
      </main>
    </div>
  );
}

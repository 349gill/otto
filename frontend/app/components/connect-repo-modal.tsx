import { useState } from "react";
import type { GitHubRepo } from "../otto-api";
import { CloseIcon } from "./icons";

type ConnectRepoModalProps = {
  isOpen: boolean;
  setupBusy: string | null;
  setupError: string;
  loadingGhRepos: boolean;
  githubRepos: GitHubRepo[];
  onClose: () => void;
  onConnectRepo: (fullName: string) => void;
  onAuthorizeGitHub: () => void;
};

export default function ConnectRepoModal({
  isOpen,
  setupBusy,
  setupError,
  loadingGhRepos,
  githubRepos,
  onClose,
  onConnectRepo,
  onAuthorizeGitHub,
}: ConnectRepoModalProps) {
  const [activeTab, setActiveTab] = useState<"github" | "manual">("github");
  const [manualUrl, setManualUrl] = useState("");

  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={onClose}
    >
      <section
        className="finding-dialog setup-dialog"
        style={{ width: "min(100%, 520px)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-top">
          <div>
            <h2 id="setup-title" style={{ margin: 0, fontSize: "16px" }}>Connect repository</h2>
            {setupBusy && (
              <small style={{ color: "var(--muted)", fontSize: "10px" }}>
                Linking in progress: you can close this window at any time.
              </small>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="dialog-close-btn"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", margin: "14px 0", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
          <button
            type="button"
            className="scan-trigger"
            style={{
              border: activeTab === "github" ? "1px solid var(--ink)" : "1px solid var(--border)",
              background: activeTab === "github" ? "var(--ink)" : "transparent",
              color: activeTab === "github" ? "var(--surface)" : "var(--ink)",
            }}
            onClick={() => setActiveTab("github")}
          >
            GitHub
          </button>
          <button
            type="button"
            className="scan-trigger"
            style={{
              border: activeTab === "manual" ? "1px solid var(--ink)" : "1px solid var(--border)",
              background: activeTab === "manual" ? "var(--ink)" : "transparent",
              color: activeTab === "manual" ? "var(--surface)" : "var(--ink)",
            }}
            onClick={() => setActiveTab("manual")}
          >
            URL
          </button>
        </div>

        {setupError && <div className="form-error" role="alert">{setupError}</div>}

        {activeTab === "github" ? (
          <div>
            {loadingGhRepos ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                Loading repositories...
              </div>
            ) : githubRepos.length > 0 ? (
              <div className="github-repo-list">
                {githubRepos.map((gh) => (
                  <div key={gh.id} className="github-repo-item">
                    <div className="github-repo-info">
                      <strong>
                        {gh.full_name}
                        {gh.private && <span className="private-badge">Private</span>}
                      </strong>
                      <small>{gh.description || "No description"}</small>
                    </div>
                    {gh.connected ? (
                      <button className="github-repo-connect-btn connected" disabled>
                        Connected
                      </button>
                    ) : (
                      <button
                        className="github-repo-connect-btn"
                        disabled={setupBusy !== null}
                        onClick={() => onConnectRepo(gh.full_name)}
                      >
                        {setupBusy === gh.full_name ? "Linking..." : "Connect"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                <p style={{ margin: 0 }}>No GitHub repositories found.</p>
                <button
                  className="github-connect"
                  style={{ marginTop: "12px", width: "100%" }}
                  onClick={onAuthorizeGitHub}
                >
                  Authorize GitHub
                </button>
              </div>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!manualUrl.trim()) return;
              const parts = manualUrl.replace(/\.git$/, "").split("/");
              const fullName = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
              onConnectRepo(fullName);
            }}
            className="setup-form"
          >
            <label>
              Repository URL
              <input
                name="url"
                type="url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                required
                placeholder="https://github.com/owner/repository"
              />
            </label>
            <button className="auth-submit" disabled={setupBusy !== null || !manualUrl}>
              {setupBusy === manualUrl ? "Connecting..." : "Connect"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

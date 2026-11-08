"use client";

import { useEffect, useState } from "react";
import OttoLogo from "./otto-logo";
import {
  connectRepo,
  disconnectRepo,
  getGitHubAuthTarget,
  getGitHubAuthUrl,
  getGitHubRepos,
  getRepository,
  getRepositories,
  triggerScan,
  type ApiFinding,
  type ApiRepo,
  type ApiRepoDetail,
  type GitHubRepo,
  type ScanHistoryPoint,
} from "./otto-api";

type WorkspaceData = {
  repos: ApiRepo[];
  details: Record<string, ApiRepoDetail>;
};

type DisplayFinding = ApiFinding & {
  key: string;
  repoId: string;
  repoName: string;
  scannedAt: string;
  commit: string;
};

async function loadWorkspace(token: string): Promise<WorkspaceData> {
  const { repos } = await getRepositories(token);
  const details = await Promise.all(
    repos.map(async (repo) => {
      try {
        const detail = await getRepository(repo.id, token);
        return [repo.id, detail] as const;
      } catch {
        return [
          repo.id,
          {
            repo: {
              id: repo.id,
              name: repo.name,
              url: repo.url,
              branch: "HEAD",
              githubFullName: repo.githubFullName,
              lastScannedCommit: null,
            },
            current: null,
            history: [],
          },
        ] as const;
      }
    }),
  );
  return { repos, details: Object.fromEntries(details) };
}

function makeChartPoints(values: number[], maximum: number) {
  const width = 640;
  const height = 220;
  const padding = 16;
  return values
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
      const y = height - padding - (value / maximum) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function displayDate(value?: string | null) {
  if (!value) return "Not yet scanned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function shortCommit(commit?: string | null) {
  return commit ? commit.slice(0, 7) : "No commit";
}

export default function ConnectedPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [scanSuccess, setScanSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const [timelineDates, setTimelineDates] = useState<string[]>([]);

  useEffect(() => {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 13; i >= 0; i--) {
      dates.push(new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    setTimelineDates(dates);
  }, []);

  // Sync theme with localStorage and html attribute
  useEffect(() => {
    const saved = window.localStorage.getItem("otto-theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("otto-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userAvatar, setUserAvatar] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [pageError, setPageError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");

  // Connect repository modal
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [loadingGhRepos, setLoadingGhRepos] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"github" | "manual">("github");

  // Selected finding dialog
  const [selectedFinding, setSelectedFinding] = useState<DisplayFinding | null>(null);

  // Initialize Auth
  useEffect(() => {
    let active = true;

    // Check hash for OAuth token redirect
    const hash = window.location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const hashToken = params.get("token");
      const hashEmail = params.get("email") ?? "";
      const hashName = params.get("name") ?? hashEmail.split("@")[0];
      const hashAvatar = params.get("avatar") ?? "";
      const hashError = params.get("error");

      if (hashError) {
        setAuthError(decodeURIComponent(hashError));
      } else if (hashToken) {
        window.sessionStorage.setItem("otto-token", hashToken);
        window.sessionStorage.setItem("otto-email", hashEmail);
        window.sessionStorage.setItem("otto-name", hashName);
        window.sessionStorage.setItem("otto-avatar", hashAvatar);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }

    Promise.resolve().then(async () => {
      const savedToken = window.sessionStorage.getItem("otto-token");
      const savedEmail = window.sessionStorage.getItem("otto-email") ?? "";
      const savedName = window.sessionStorage.getItem("otto-name") ?? savedEmail.split("@")[0];
      const savedAvatar = window.sessionStorage.getItem("otto-avatar") ?? "";

      if (!savedToken) {
        if (active) setAuthReady(true);
        return;
      }

      if (active) {
        setToken(savedToken);
        setUserEmail(savedEmail);
        setUserName(savedName);
        setUserAvatar(savedAvatar);
      }

      try {
        const loaded = await loadWorkspace(savedToken);
        if (active) setWorkspace(loaded);
      } catch (error: unknown) {
        window.sessionStorage.removeItem("otto-token");
        window.sessionStorage.removeItem("otto-email");
        window.sessionStorage.removeItem("otto-name");
        window.sessionStorage.removeItem("otto-avatar");
        if (active) {
          setToken(null);
          setAuthError(error instanceof Error ? error.message : "Unable to load workspace.");
        }
      } finally {
        if (active) setAuthReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // Fetch GitHub repos when modal opens
  useEffect(() => {
    if (!setupOpen || !token) return;
    setLoadingGhRepos(true);
    setSetupError("");
    getGitHubRepos(token)
      .then((data) => {
        setGithubRepos(data.repos);
      })
      .catch((err) => {
        // User may have logged in with email and has no linked GitHub token
        setGithubRepos([]);
        setSetupError(err.message || "Failed to load GitHub repositories.");
      })
      .finally(() => {
        setLoadingGhRepos(false);
      });
  }, [setupOpen, token]);

  const repos = workspace?.repos ?? [];
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedName = selectedRepo?.name ?? "All repositories";
  const scopedRepos = selectedRepo ? [selectedRepo] : repos;

  const latestCounts = scopedRepos.reduce(
    (total, repo) => ({
      serious: total.serious + (repo.lastScan?.counts.serious ?? 0),
      minor: total.minor + (repo.lastScan?.counts.minor ?? 0),
    }),
    { serious: 0, minor: 0 },
  );

  const totalScans = scopedRepos.reduce((total, repo) => {
    const history = workspace?.details[repo.id]?.history ?? [];
    return total + history.reduce((count, item) => count + item.scans, 0);
  }, 0);

  const passingRepos = scopedRepos.filter((repo) => repo.lastScan?.status === "pass").length;

  const latestScanDate = scopedRepos
    .map((repo) => workspace?.details[repo.id]?.current?.scannedAt ?? repo.lastScan?.at ?? null)
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  // Continuous 14-day timeline populated on client mount
  const timelineMap = new Map<string, ScanHistoryPoint>();
  for (const dateStr of timelineDates) {
    timelineMap.set(dateStr, { date: dateStr, serious: 0, minor: 0, scans: 0 });
  }

  for (const repo of scopedRepos) {
    for (const point of workspace?.details[repo.id]?.history ?? []) {
      const current = timelineMap.get(point.date) ?? { date: point.date, serious: 0, minor: 0, scans: 0 };
      current.serious += point.serious ?? 0;
      current.minor += point.minor ?? 0;
      current.scans += point.scans ?? 0;
      timelineMap.set(point.date, current);
    }
  }

  const chartHistory = [...timelineMap.values()].sort((left, right) => left.date.localeCompare(right.date));
  const rawMax = Math.max(0, ...chartHistory.flatMap((point) => [point.serious, point.minor]));
  const chartMaximum = Math.max(4, rawMax);
  const seriousLine = makeChartPoints(chartHistory.map((point) => point.serious), chartMaximum);
  const minorLine = makeChartPoints(chartHistory.map((point) => point.minor), chartMaximum);

  const allFindings: DisplayFinding[] = scopedRepos
    .flatMap((repo) => {
      const current = workspace?.details[repo.id]?.current;
      return (current?.findings ?? []).map((finding, index) => ({
        ...finding,
        key: `${repo.id}-${current?.commit ?? "current"}-${index}-${finding.ruleId}`,
        repoId: repo.id,
        repoName: repo.name,
        scannedAt: current?.scannedAt ?? "",
        commit: current?.commit ?? "",
      }));
    })
    .sort((left, right) => new Date(right.scannedAt).getTime() - new Date(left.scannedAt).getTime());

  const visibleFindings = allFindings.filter((finding) =>
    `${finding.title} ${finding.comment} ${finding.file} ${finding.fix} ${finding.ruleId} ${finding.repoName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  async function handleGitHubLogin() {
    try {
      const targetUrl = await getGitHubAuthTarget();
      window.location.href = targetUrl;
    } catch {
      window.location.href = getGitHubAuthUrl();
    }
  }

  async function refreshWorkspace() {
    if (!token) return;
    setRefreshing(true);
    setPageError("");
    try {
      setWorkspace(await loadWorkspace(token));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh workspace.";
      setPageError(message);
      if (message.toLowerCase().includes("token")) handleSignOut();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleTriggerScan(repoId: string) {
    if (!token || scanning) return;
    setScanning(true);
    setPageError("");
    try {
      await triggerScan(token, repoId);
      await refreshWorkspace();
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 4500);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function handleConnectRepo(fullName: string) {
    if (!token) return;
    setSetupBusy(true);
    setSetupError("");
    try {
      await connectRepo(token, fullName);
      const updated = await loadWorkspace(token);
      setWorkspace(updated);
      setSetupOpen(false);
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 4500);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to connect repository.");
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleDisconnectRepo(repoId: string) {
    if (!token || !confirm("Disconnect this repository from Otto? Scans will be deleted.")) return;
    try {
      await disconnectRepo(token, repoId);
      if (selectedRepoId === repoId) setSelectedRepoId(null);
      await refreshWorkspace();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to disconnect repository.");
    }
  }

  function handleSignOut() {
    window.sessionStorage.removeItem("otto-token");
    window.sessionStorage.removeItem("otto-email");
    window.sessionStorage.removeItem("otto-name");
    window.sessionStorage.removeItem("otto-avatar");
    setToken(null);
    setWorkspace(null);
    setSelectedRepoId(null);
    setPageError("");
  }

  if (!authReady) {
    return (
      <div className="auth-loading">
        <OttoLogo className="h-6 w-auto" />
        <span>Loading Otto</span>
      </div>
    );
  }

  // Login view
  if (!token || !workspace) {
    return (
      <div className="auth-screen" data-theme={theme}>
        <main className="auth-main" id="signin">
          <button
            className="auth-theme-toggle"
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
          >
            {theme === "light" ? "◐ Dark mode" : "☼ Light mode"}
          </button>
          <div className="auth-panel">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
              <OttoLogo className="h-11 w-auto" />
            </div>
            <p style={{ textAlign: "center", color: "var(--muted)", margin: "-6px 0 24px", fontSize: "11px", letterSpacing: "0.02em" }}>
              AUTOMATED CODE &amp; NETWORK SECURITY
            </p>

            {authError && <div className="form-error" role="alert">{authError}</div>}

            <button
              className="github-connect"
              type="button"
              style={{ width: "100%", height: "46px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
              onClick={handleGitHubLogin}
            >
              Sign in with GitHub
            </button>

            <p style={{ textAlign: "center", color: "var(--muted)", margin: "16px 0 0", fontSize: "10px", lineHeight: "1.5" }}>
              Sign in with GitHub to access your repositories and monitor pull requests for security vulnerabilities.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Dashboard view
  return (
    <div className="dashboard" data-theme={theme}>
      {/* Sidebar */}
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Otto home">
          <OttoLogo className="h-5 w-auto" />
          <span className="brand-ai">SECURITY</span>
        </a>

        <div className="workspace-switcher">
          {userAvatar ? (
            <img src={userAvatar} alt={userName} className="workspace-avatar" style={{ borderRadius: "5px" }} />
          ) : (
            <span className="workspace-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span>
          )}
          <span className="workspace-copy">
            <strong>{userName || "Otto workspace"}</strong>
            <small>{userEmail || "Connected with GitHub"}</small>
          </span>
          <span className="switcher-caret" aria-hidden="true">⌄</span>
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <button
            className="nav-item active"
            onClick={() => document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" })}
          >
            <span className="nav-glyph">◫</span> Overview
          </button>
          <button
            className="nav-item"
            onClick={() => document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" })}
          >
            <span className="nav-glyph">⌕</span> Findings{" "}
            <span className="nav-count">{allFindings.length}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" })}
          >
            <span className="nav-glyph">↗</span> Activity
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-heading">
            <span>LINKED REPOSITORIES</span>
            <button
              aria-label="Connect GitHub repository"
              title="Connect a GitHub repository"
              onClick={() => {
                setSetupError("");
                setSetupOpen(true);
              }}
            >
              + Connect
            </button>
          </div>

          <button
            className={`target-item ${selectedRepoId === null ? "selected" : ""}`}
            onClick={() => setSelectedRepoId(null)}
          >
            <span className="target-symbol all-symbol">✳</span>
            <span className="target-label">All repositories</span>
            <span className="target-count">{repos.length}</span>
          </button>

          {repos.map((repo, index) => (
            <button
              key={repo.id}
              className={`target-item ${selectedRepoId === repo.id ? "selected" : ""}`}
              onClick={() => setSelectedRepoId(repo.id)}
            >
              <span className={`repo-avatar ${["mint", "coral", "gold"][index % 3]}`}>
                {repo.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="target-label" title={repo.githubFullName || repo.name}>
                {repo.name}
              </span>
              <span className="target-count">
                {(repo.lastScan?.counts.serious ?? 0) + (repo.lastScan?.counts.minor ?? 0)}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="connection-state">
            <span className="connection-dot" /> API connected
          </div>
          <button className="profile-button" onClick={handleSignOut}>
            {userAvatar ? (
              <img src={userAvatar} alt={userName} className="profile-avatar" style={{ borderRadius: "5px" }} />
            ) : (
              <span className="profile-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span>
            )}
            <span className="profile-copy">
              <strong>{userName || userEmail}</strong>
              <small>Sign out</small>
            </span>
            <span className="profile-menu">↗</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-area" id="overview">
        {/* Topbar */}
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{selectedName}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-label">
              <span /> LIVE API
            </span>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-pressed={theme === "dark"}
            >
              <span className="theme-symbol" aria-hidden="true">
                {theme === "light" ? "◐" : "☼"}
              </span>
              <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
            </button>
            <button className="signout-button" onClick={handleSignOut} title="Sign out of Otto">
              Sign out
            </button>
          </div>
        </header>

        {/* Scan Success Toast */}
        {scanSuccess && (
          <div className="scan-success-overlay" role="status" aria-live="polite">
            <div className="scan-success-box">
              <div className="scan-success-icon">✓</div>
              <div>
                <strong>Scan Completed</strong>
                <p>Code and security vulnerabilities analyzed.</p>
              </div>
              <button
                className="scan-success-close"
                onClick={() => setScanSuccess(false)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="page-content">
          {/* Page Heading & Actions */}
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-rule" /> CODE &amp; NETWORK SECURITY
              </div>
              <h1>{selectedRepo ? selectedName : "Security overview"}</h1>
              <p>
                {selectedRepo
                  ? `${selectedRepo.githubFullName || selectedRepo.url} — Branch: ${
                      workspace?.details[selectedRepo.id]?.repo.branch ?? "HEAD"
                    }`
                  : "Ranked vulnerabilities across application code and network configurations."}
              </p>
            </div>
            <div className="scan-status">
              {selectedRepo && (
                <>
                  <button
                    className="scan-trigger"
                    disabled={scanning}
                    onClick={() => handleTriggerScan(selectedRepo.id)}
                  >
                    {scanning ? "Scanning..." : "▶ Scan now"}
                  </button>
                  <button
                    className="refresh-button"
                    title="Disconnect repository"
                    style={{ color: "var(--serious)" }}
                    onClick={() => handleDisconnectRepo(selectedRepo.id)}
                  >
                    ✕
                  </button>
                </>
              )}
              <span className="scan-status-dot" />
              <span>
                Latest scan <strong>{displayDate(latestScanDate)}</strong>
              </span>
              <button
                className="refresh-button"
                aria-label="Refresh workspace"
                title="Refresh from backend"
                disabled={refreshing}
                onClick={refreshWorkspace}
              >
                {refreshing ? "…" : "↻"}
              </button>
            </div>
          </section>

          {pageError && (
            <div className="page-error" role="alert">
              {pageError}
              <button onClick={() => setPageError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}

          {/* Metric Summary Cards */}
          <section className="summary-grid" aria-label="Latest scan summary">
            <article className="summary-card serious-card">
              <div className="summary-card-top">
                <span>Serious vulnerabilities</span>
                <span className="severity-mark serious-mark">!</span>
              </div>
              <div className="summary-number">
                {latestCounts.serious}
                <span className="summary-unit"> current</span>
              </div>
              <div className="summary-foot">
                <span className="severity-dot serious-dot" /> High risk in context
              </div>
            </article>

            <article className="summary-card minor-card">
              <div className="summary-card-top">
                <span>Minor vulnerabilities</span>
                <span className="severity-mark minor-mark">~</span>
              </div>
              <div className="summary-number">
                {latestCounts.minor}
                <span className="summary-unit"> current</span>
              </div>
              <div className="summary-foot">
                <span className="severity-dot minor-dot" /> Secondary or chain risk
              </div>
            </article>

            <article className="summary-card info-card">
              <div className="summary-card-top">
                <span>Connected repositories</span>
                <span className="severity-mark info-mark">⌘</span>
              </div>
              <div className="summary-number">
                {scopedRepos.length}
                <span className="summary-unit"> repos</span>
              </div>
              <div className="summary-foot">
                <span className="severity-dot info-dot" /> Audited on every PR
              </div>
            </article>

            <article className="summary-card resolved-card">
              <div className="summary-card-top">
                <span>Passing latest scans</span>
                <span className="resolved-mark">✓</span>
              </div>
              <div className="summary-number">
                {passingRepos}
                <span className="summary-unit"> of {scopedRepos.length} repos</span>
              </div>
              <div className="summary-foot">
                <span className="resolved-trend">↗</span>
                {totalScans} scans recorded
              </div>
            </article>
          </section>

          {/* Analytics Charts */}
          <section className="analytics-grid" id="activity">
            <article className="panel chart-panel">
              <div className="panel-heading chart-heading">
                <div>
                  <span className="section-kicker">SCAN HISTORY</span>
                  <h2>Vulnerabilities over 30 days</h2>
                  <p>Severity counts recorded by completed scans</p>
                </div>
                <span className="chart-period">LAST 30 DAYS</span>
              </div>

              <div className="chart-legend">
                <span>
                  <i className="legend-dot opened-dot" /> Serious
                </span>
                <span>
                  <i className="legend-dot resolved-dot" /> Minor
                </span>
                <span className="chart-target">{selectedName}</span>
              </div>

              {chartHistory.length > 0 ? (
                <>
                  <div className="chart-wrap">
                    <div className="chart-y-labels" aria-hidden="true">
                      <span>{chartMaximum}</span>
                      <span>{Math.round(chartMaximum * 0.66)}</span>
                      <span>{Math.round(chartMaximum * 0.33)}</span>
                      <span>0</span>
                    </div>
                    <svg
                      className="activity-chart"
                      viewBox="0 0 640 220"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={`Vulnerabilities over 30 days for ${selectedName}`}
                    >
                      {[16, 78.7, 141.3, 204].map((y) => (
                        <line key={y} x1="16" y1={y} x2="624" y2={y} className="chart-gridline" />
                      ))}
                      <polyline points={seriousLine} className="chart-line opened-line" />
                      <polyline points={minorLine} className="chart-line resolved-line" />
                      {chartHistory.map((point, index) => {
                        const width = 640;
                        const height = 220;
                        const padding = 16;
                        const x = padding + (index * (width - padding * 2)) / Math.max(chartHistory.length - 1, 1);
                        const ySerious = height - padding - (point.serious / chartMaximum) * (height - padding * 2);
                        const yMinor = height - padding - (point.minor / chartMaximum) * (height - padding * 2);
                        return (
                          <g key={point.date}>
                            {point.serious > 0 && (
                              <circle cx={x} cy={ySerious} r="4.5" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2">
                                <title>{`${point.date}: ${point.serious} serious vulnerability${point.serious > 1 ? "s" : ""}`}</title>
                              </circle>
                            )}
                            {point.minor > 0 && (
                              <circle cx={x} cy={yMinor} r="4" fill="var(--muted)" stroke="var(--surface)" strokeWidth="1.5">
                                <title>{`${point.date}: ${point.minor} minor vulnerability${point.minor > 1 ? "s" : ""}`}</title>
                              </circle>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="chart-x-labels">
                    {chartHistory.map((point, index) => (
                      <span
                        className={
                          index % Math.max(1, Math.ceil(chartHistory.length / 5)) === 0 ||
                          index === chartHistory.length - 1
                            ? ""
                            : "label-hidden"
                        }
                        key={point.date}
                      >
                        {new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="chart-empty">Scan history will appear here after a repository has been scanned.</div>
              )}
              <div className="chart-note">
                <span className="note-spark">✳</span> High-sensitivity vulnerability detection powered by Gemini AI.
              </div>
            </article>

            <article className="panel distribution-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">CURRENT EXPOSURE</span>
                  <h2>By severity</h2>
                  <p>Counts from latest scans</p>
                </div>
                <span className="distribution-total">
                  {latestCounts.serious + latestCounts.minor}
                  <small> total</small>
                </span>
              </div>

              <div className="severity-bar" aria-label="Latest findings by severity">
                <span className="bar-serious" style={{ flex: Math.max(latestCounts.serious, 0.1) }} />
                <span className="bar-minor" style={{ flex: Math.max(latestCounts.minor, 0.1) }} />
              </div>

              <div className="severity-breakdown">
                <div>
                  <span className="severity-dot serious-dot" />
                  <span>Serious</span>
                  <strong>{latestCounts.serious}</strong>
                </div>
                <div>
                  <span className="severity-dot minor-dot" />
                  <span>Minor</span>
                  <strong>{latestCounts.minor}</strong>
                </div>
              </div>

              <div className="distribution-divider" />

              <div className="resolution-callout">
                <span className="callout-check">✓</span>
                <div>
                  <strong>{passingRepos} repositories passed</strong>
                  <small>Zero serious or minor vulnerabilities found</small>
                </div>
              </div>

              <div className="policy-note">
                <span className="policy-glyph">i</span>
                <span>
                  Findings cite file, line, and rule ID. PR comments suggest concrete code fixes.
                </span>
              </div>
            </article>
          </section>

          {/* Findings Table */}
          <section className="panel findings-panel" id="findings">
            <div className="panel-heading findings-heading">
              <div>
                <span className="section-kicker">SECURITY FINDINGS</span>
                <h2>Vulnerability list</h2>
                <p>Deterministic checks and AI triage results across active repos</p>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search vulnerabilities, rules..."
                  aria-label="Search findings"
                />
                <kbd>/</kbd>
              </label>
            </div>

            <div className="findings-table" role="table" aria-label="Current repository findings">
              <div
                className="finding-header"
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(200px, 2.5fr) minmax(120px, 1fr) 90px 100px 85px 110px 20px",
                }}
              >
                <span>VULNERABILITY</span>
                <span>REPOSITORY</span>
                <span>RULE ID</span>
                <span>ENGINE</span>
                <span>SEVERITY</span>
                <span>SCAN</span>
                <span />
              </div>

              {visibleFindings.length > 0 ? (
                visibleFindings.map((finding) => (
                  <button
                    className="finding-row"
                    key={finding.key}
                    onClick={() => setSelectedFinding(finding)}
                    role="row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(200px, 2.5fr) minmax(120px, 1fr) 90px 100px 85px 110px 20px",
                    }}
                  >
                    <span className="finding-main">
                      <span className={`row-severity ${finding.severity === "serious" ? "serious" : "minor"}`} />
                      <span className="finding-copy">
                        <strong>{finding.title || finding.comment}</strong>
                        <small>
                          {finding.file}
                          {finding.line > 0 ? `:${finding.line}` : ""} <i /> {shortCommit(finding.commit)}
                        </small>
                      </span>
                    </span>

                    <span className="finding-repo">
                      <span className="source-tag code">Code</span>
                      <span>{finding.repoName}</span>
                    </span>

                    <span>
                      <span className="rule-id">{finding.ruleId || "—"}</span>
                    </span>

                    <span>
                      <span className={`source-badge ${finding.source}`}>
                        Gemini AI
                      </span>
                    </span>

                    <span>
                      <span className={`severity-pill ${finding.severity === "serious" ? "serious" : "minor"}`}>
                        {finding.severity}
                      </span>
                    </span>

                    <span className="finding-age">{displayDate(finding.scannedAt)}</span>
                    <span className="row-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  {search ? "No vulnerabilities match this search." : "No vulnerabilities detected in this view."}
                </div>
              )}
            </div>

            <div className="findings-footer">
              <span>{visibleFindings.length} findings from latest scans</span>
              <span className="findings-footer-note">Select any finding to inspect evidence, rule, and suggested fix.</span>
            </div>
          </section>

          <footer className="page-footer">
            <span>Otto Security Assessment Platform</span>
            <span>
              <i /> Deterministic analysis with Gemini AI triage · PR comments enabled
            </span>
          </footer>
        </div>
      </main>

      {/* Connect Repository Dialog */}
      {setupOpen && (
        <div className="dialog-backdrop" onClick={() => !setupBusy && setSetupOpen(false)}>
          <section
            className="finding-dialog setup-dialog"
            style={{ width: "min(100%, 560px)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-top">
              <span className="section-kicker">LINK REPOSITORY</span>
              <button onClick={() => setSetupOpen(false)} aria-label="Close dialog" disabled={setupBusy}>
                ×
              </button>
            </div>
            <h2 id="setup-title">Connect a GitHub repository</h2>
            <p className="setup-intro">
              Select a repository to monitor. Otto will generate project context, scan PRs via GitHub Actions, and comment fixes directly on code changes.
            </p>

            <div style={{ display: "flex", gap: "8px", marginBottom: "14px", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
              <button
                type="button"
                className={`scan-trigger ${activeTab === "github" ? "" : "rule-id"}`}
                style={{
                  border: activeTab === "github" ? "1px solid var(--teal)" : "1px solid var(--border)",
                  background: activeTab === "github" ? "var(--teal-soft)" : "transparent",
                }}
                onClick={() => setActiveTab("github")}
              >
                GitHub Repositories
              </button>
              <button
                type="button"
                className={`scan-trigger ${activeTab === "manual" ? "" : "rule-id"}`}
                style={{
                  border: activeTab === "manual" ? "1px solid var(--teal)" : "1px solid var(--border)",
                  background: activeTab === "manual" ? "var(--teal-soft)" : "transparent",
                }}
                onClick={() => setActiveTab("manual")}
              >
                Manual URL
              </button>
            </div>

            {setupError && <div className="form-error" role="alert">{setupError}</div>}

            {activeTab === "github" ? (
              <div>
                {loadingGhRepos ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                    Loading your GitHub repositories...
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
                            Connected ✓
                          </button>
                        ) : (
                          <button
                            className="github-repo-connect-btn"
                            disabled={setupBusy}
                            onClick={() => handleConnectRepo(gh.full_name)}
                          >
                            {setupBusy ? "Linking..." : "+ Connect"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: "11px" }}>
                    <p>No GitHub repositories found.</p>
                    <button
                      className="github-connect"
                      style={{ marginTop: "12px", width: "100%" }}
                      onClick={handleGitHubLogin}
                    >
                      Authorize GitHub Access
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
                  handleConnectRepo(fullName);
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
                <button className="auth-submit" disabled={setupBusy || !manualUrl}>
                  {setupBusy ? "Connecting..." : "Connect Repository"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      {/* Finding Detail Dialog */}
      {selectedFinding && (
        <div className="dialog-backdrop" onClick={() => setSelectedFinding(null)}>
          <section
            className="finding-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-top">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`severity-pill ${selectedFinding.severity === "serious" ? "serious" : "minor"}`}>
                  {selectedFinding.severity}
                </span>
                <span className={`source-badge ${selectedFinding.source}`}>
                  Gemini AI
                </span>
                <span className="rule-id" style={{ fontSize: "10px" }}>
                  {selectedFinding.ruleId}
                </span>
              </div>
              <button onClick={() => setSelectedFinding(null)} aria-label="Close dialog">
                ×
              </button>
            </div>

            <div className="dialog-id">
              {selectedFinding.repoName} <i /> commit {shortCommit(selectedFinding.commit)}
            </div>

            <h2 id="dialog-title">{selectedFinding.title || selectedFinding.comment}</h2>
            <p className="dialog-location">
              {selectedFinding.file}
              {selectedFinding.line > 0 ? `:${selectedFinding.line}` : ""}
            </p>

            <div className="dialog-section">
              <span className="section-kicker">EVIDENCE &amp; DESCRIPTION</span>
              <p>{selectedFinding.comment}</p>
            </div>

            {selectedFinding.fix && (
              <div className="otto-suggestion">
                <div className="otto-suggestion-heading">
                  <OttoLogo className="h-3 w-auto" />
                  <strong>Suggested Fix</strong>
                  <span>ACTIONABLE</span>
                </div>
                <p>{selectedFinding.fix}</p>
                <small>Review the suggestion and verify it against your code and policy before applying.</small>
              </div>
            )}

            <button className="dialog-done" onClick={() => setSelectedFinding(null)}>
              Done
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  addRepository,
  authenticate,
  getRepository,
  getRepositories,
  type ApiFinding,
  type ApiRepo,
  type ApiRepoDetail,
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
    repos.map(async (repo) => [repo.id, await getRepository(repo.id, token)] as const),
  );
  return { repos, details: Object.fromEntries(details) };
}

function makeChartPoints(values: number[], maximum: number) {
  const width = 640;
  const height = 220;
  const padding = 16;
  return values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
    const y = height - padding - (value / maximum) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
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
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [setupConsent, setSetupConsent] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<DisplayFinding | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      const savedToken = window.sessionStorage.getItem("otto-token");
      const savedEmail = window.sessionStorage.getItem("otto-email") ?? "";
      const savedName = window.sessionStorage.getItem("otto-name") ?? savedEmail.split("@")[0];
      if (!savedToken) {
        if (active) setAuthReady(true);
        return;
      }

      if (active) {
        setToken(savedToken);
        setUserEmail(savedEmail);
        setUserName(savedName);
      }
      try {
        const loaded = await loadWorkspace(savedToken);
        if (active) setWorkspace(loaded);
      } catch (error: unknown) {
        window.sessionStorage.removeItem("otto-token");
        window.sessionStorage.removeItem("otto-email");
        if (active) {
          setToken(null);
          setAuthError(error instanceof Error ? error.message : "Unable to load your workspace.");
        }
      } finally {
        if (active) setAuthReady(true);
      }
    });
    return () => { active = false; };
  }, []);

  const repos = workspace?.repos ?? [];
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedName = selectedRepo?.name ?? "All repositories";
  const scopedRepos = selectedRepo ? [selectedRepo] : repos;
  const latestCounts = scopedRepos.reduce(
    (total, repo) => ({
      severe: total.severe + (repo.lastScan?.counts.severe ?? 0),
      minor: total.minor + (repo.lastScan?.counts.minor ?? 0),
    }),
    { severe: 0, minor: 0 },
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

  const historyByDate = new Map<string, ScanHistoryPoint>();
  for (const repo of scopedRepos) {
    for (const point of workspace?.details[repo.id]?.history ?? []) {
      const current = historyByDate.get(point.date) ?? { date: point.date, severe: 0, minor: 0, scans: 0 };
      current.severe += point.severe;
      current.minor += point.minor;
      current.scans += point.scans;
      historyByDate.set(point.date, current);
    }
  }
  const chartHistory = [...historyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const chartMaximum = Math.max(1, ...chartHistory.flatMap((point) => [point.severe, point.minor]));
  const severeLine = makeChartPoints(chartHistory.map((point) => point.severe), chartMaximum);
  const minorLine = makeChartPoints(chartHistory.map((point) => point.minor), chartMaximum);

  const allFindings: DisplayFinding[] = scopedRepos.flatMap((repo) => {
    const current = workspace?.details[repo.id]?.current;
    return (current?.findings ?? []).map((finding, index) => ({
      ...finding,
      key: `${repo.id}-${current?.commit ?? "current"}-${index}`,
      repoId: repo.id,
      repoName: repo.name,
      scannedAt: current?.scannedAt ?? "",
      commit: current?.commit ?? "",
    }));
  }).sort((left, right) => new Date(right.scannedAt).getTime() - new Date(left.scannedAt).getTime());
  const visibleFindings = allFindings.filter((finding) =>
    `${finding.comment} ${finding.file} ${finding.fix} ${finding.repoName}`.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    try {
      const result = await authenticate(email, password);
      const loaded = await loadWorkspace(result.token);
      const name = result.user.email.split("@")[0];
      window.sessionStorage.setItem("otto-token", result.token);
      window.sessionStorage.setItem("otto-email", result.user.email);
      window.sessionStorage.setItem("otto-name", name);
      setToken(result.token);
      setUserEmail(result.user.email);
      setUserName(name);
      setWorkspace(loaded);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function refreshWorkspace() {
    if (!token) return;
    setRefreshing(true);
    setPageError("");
    try {
      setWorkspace(await loadWorkspace(token));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh your workspace.";
      setPageError(message);
      if (message.toLowerCase().includes("token")) handleSignOut();
    } finally {
      setRefreshing(false);
    }
  }

  function handleSignOut() {
    window.sessionStorage.removeItem("otto-token");
    window.sessionStorage.removeItem("otto-email");
    window.sessionStorage.removeItem("otto-name");
    setToken(null);
    setWorkspace(null);
    setSelectedRepoId(null);
    setPageError("");
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !setupConsent) return;
    setSetupBusy(true);
    setSetupError("");
    const formData = new FormData(event.currentTarget);
    try {
      await addRepository(token, {
        url: String(formData.get("url") ?? "").trim(),
        name: String(formData.get("name") ?? "").trim() || undefined,
      });
      setWorkspace(await loadWorkspace(token));
      setSetupOpen(false);
      setSetupConsent(false);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to add this repository.");
    } finally {
      setSetupBusy(false);
    }
  }

  if (!authReady) {
    return <div className="auth-loading"><span className="brand-mark">o</span><span>Loading Otto</span></div>;
  }

  if (!token || !workspace) {
    return (
      <div className="auth-screen" data-theme={theme}>
        <main className="auth-main" id="signin">
          <button className="auth-theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-pressed={theme === "dark"}>{theme === "light" ? "◐ Dark mode" : "☼ Light mode"}</button>
          <div className="auth-panel">
            <h1 className="login-brand">Otto</h1>
            <form className="auth-form" onSubmit={handleAuth}>
              {authError && <div className="form-error" role="alert">{authError}</div>}
              <label>Email<input name="email" type="email" autoComplete="email" required placeholder="Email" /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required placeholder="Password" /></label>
              <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Signing in..." : "Sign in"}</button>
            </form>
            <div className="auth-divider"><span>OR</span></div>
            <button className="github-connect" type="button" onClick={() => setAuthNotice("GitHub sign-in is not configured yet. Use your email and password for now.")}>Sign in with GitHub</button>
            {authNotice && <small className="auth-notice" role="status">{authNotice}</small>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard" data-theme={theme}>
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Otto home"><span className="brand-mark">o</span><span>otto<span className="brand-dot">.</span></span><span className="brand-ai">AI</span></a>
        <div className="workspace-switcher"><span className="workspace-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span><span className="workspace-copy"><strong>{userName || "Otto workspace"}</strong><small>{userEmail}</small></span><span className="switcher-caret" aria-hidden="true">⌄</span></div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className="nav-item active" onClick={() => document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-glyph">◫</span> Overview</button>
          <button className="nav-item" onClick={() => document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-glyph">⌕</span> Findings <span className="nav-count">{allFindings.length}</span></button>
          <button className="nav-item" onClick={() => document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-glyph">↗</span> Activity</button>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-heading"><span>GITHUB REPOSITORIES</span><button aria-label="Connect GitHub repository" title="Connect a public GitHub repository" onClick={() => { setSetupError(""); setSetupOpen(true); }}>+ Connect</button></div>
          <button className={`target-item ${selectedRepoId === null ? "selected" : ""}`} onClick={() => setSelectedRepoId(null)}><span className="target-symbol all-symbol">✳</span><span className="target-label">All repositories</span><span className="target-count">{repos.length}</span></button>
          {repos.map((repo, index) => (
            <button key={repo.id} className={`target-item ${selectedRepoId === repo.id ? "selected" : ""}`} onClick={() => setSelectedRepoId(repo.id)}>
              <span className={`repo-avatar ${["mint", "coral", "gold"][index % 3]}`}>{repo.name.slice(0, 2).toUpperCase()}</span><span className="target-label">{repo.name}</span><span className="target-count">{(repo.lastScan?.counts.severe ?? 0) + (repo.lastScan?.counts.minor ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><div className="connection-state"><span className="connection-dot" /> API connected</div><button className="profile-button" onClick={handleSignOut}><span className="profile-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span><span className="profile-copy"><strong>{userName || userEmail}</strong><small>{userEmail} · Sign out</small></span><span className="profile-menu">↗</span></button></div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{selectedName}</strong></div><div className="topbar-actions"><span className="demo-label"><span /> LIVE API</span><button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-pressed={theme === "dark"}><span className="theme-symbol" aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span><span>{theme === "light" ? "Dark mode" : "Light mode"}</span></button><button className="avatar-button" aria-label="Sign out" onClick={handleSignOut}>{userEmail.slice(0, 1).toUpperCase() || "O"}</button></div></header>
        <div className="page-content">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-rule" /> CODE SECURITY</div><h1>{selectedRepo ? selectedName : "Security overview"}</h1><p>{selectedRepo ? selectedRepo.url : "Current findings and scan history across your connected repositories."}</p></div><div className="scan-status"><span className="scan-status-dot" /><span>Latest scan <strong>{displayDate(latestScanDate)}</strong></span><button className="refresh-button" aria-label="Refresh workspace" title="Refresh from backend" disabled={refreshing} onClick={refreshWorkspace}>{refreshing ? "…" : "↻"}</button></div></section>
          {pageError && <div className="page-error" role="alert">{pageError}<button onClick={() => setPageError("")} aria-label="Dismiss error">×</button></div>}

          <section className="summary-grid" aria-label="Latest scan summary">
            <article className="summary-card serious-card"><div className="summary-card-top"><span>Severe findings</span><span className="severity-mark serious-mark">!</span></div><div className="summary-number">{latestCounts.severe}<span className="summary-unit"> current</span></div><div className="summary-foot"><span className="severity-dot serious-dot" />From latest scans</div></article>
            <article className="summary-card minor-card"><div className="summary-card-top"><span>Minor findings</span><span className="severity-mark minor-mark">~</span></div><div className="summary-number">{latestCounts.minor}<span className="summary-unit"> current</span></div><div className="summary-foot"><span className="severity-dot minor-dot" />From latest scans</div></article>
            <article className="summary-card info-card"><div className="summary-card-top"><span>Connected repositories</span><span className="severity-mark info-mark">⌘</span></div><div className="summary-number">{scopedRepos.length}<span className="summary-unit"> repos</span></div><div className="summary-foot"><span className="severity-dot info-dot" />Owned by this account</div></article>
            <article className="summary-card resolved-card"><div className="summary-card-top"><span>Passing latest scans</span><span className="resolved-mark">✓</span></div><div className="summary-number">{passingRepos}<span className="summary-unit"> of {scopedRepos.length} repos</span></div><div className="summary-foot"><span className="resolved-trend">↗</span>{totalScans} scans in the last 30 days</div></article>
          </section>

          <section className="analytics-grid" id="activity">
            <article className="panel chart-panel"><div className="panel-heading chart-heading"><div><span className="section-kicker">SCAN HISTORY</span><h2>Findings over 30 days</h2><p>Severity counts recorded by completed scans</p></div><span className="chart-period">LAST 30 DAYS</span></div>
              <div className="chart-legend"><span><i className="legend-dot opened-dot" />Severe</span><span><i className="legend-dot resolved-dot" />Minor</span><span className="chart-target">{selectedName}</span></div>
              {chartHistory.length > 0 ? <><div className="chart-wrap"><div className="chart-y-labels" aria-hidden="true"><span>{chartMaximum}</span><span>{Math.round(chartMaximum * 0.66)}</span><span>{Math.round(chartMaximum * 0.33)}</span><span>0</span></div><svg className="activity-chart" viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={`Severe and minor findings during the last 30 days for ${selectedName}`}>{[16, 78.7, 141.3, 204].map((y) => <line key={y} x1="16" y1={y} x2="624" y2={y} className="chart-gridline" />)}<polyline pathLength="1" points={severeLine} className="chart-line opened-line" /><polyline pathLength="1" points={minorLine} className="chart-line resolved-line" /></svg></div><div className="chart-x-labels">{chartHistory.map((point, index) => <span className={index % Math.max(1, Math.ceil(chartHistory.length / 5)) === 0 || index === chartHistory.length - 1 ? "" : "label-hidden"} key={point.date}>{new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>)}</div></> : <div className="chart-empty">Scan history will appear here after a repository has been scanned.</div>}
              <div className="chart-note"><span className="note-spark">✳</span> History reflects backend scan records, not estimated trends.</div>
            </article>
            <article className="panel distribution-panel"><div className="panel-heading"><div><span className="section-kicker">CURRENT EXPOSURE</span><h2>By severity</h2><p>Counts from latest scans</p></div><span className="distribution-total">{latestCounts.severe + latestCounts.minor}<small> total</small></span></div>
              <div className="severity-bar" aria-label="Latest findings by severity"><span className="bar-serious" style={{ flex: Math.max(latestCounts.severe, 0.1) }} /><span className="bar-minor" style={{ flex: Math.max(latestCounts.minor, 0.1) }} /></div>
              <div className="severity-breakdown"><div><span className="severity-dot serious-dot" /><span>Severe</span><strong>{latestCounts.severe}</strong></div><div><span className="severity-dot minor-dot" /><span>Minor</span><strong>{latestCounts.minor}</strong></div></div><div className="distribution-divider" />
              <div className="resolution-callout"><span className="callout-check">✓</span><div><strong>{passingRepos} repositories passed</strong><small>Based on each repository&apos;s latest scan</small></div></div><div className="policy-note"><span className="policy-glyph">i</span><span>Findings are produced by Otto&apos;s current scan rules. Review evidence before acting.</span></div>
            </article>
          </section>

          <section className="panel findings-panel" id="findings"><div className="panel-heading findings-heading"><div><span className="section-kicker">LATEST SCANS</span><h2>Current findings</h2><p>Findings attached to each repository&apos;s latest scan</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search findings" aria-label="Search findings" /><kbd>/</kbd></label></div>
            <div className="findings-table" role="table" aria-label="Current repository findings"><div className="finding-header" role="row"><span>FINDING</span><span>REPOSITORY</span><span>SEVERITY</span><span>SCAN</span><span /></div>
              {visibleFindings.length > 0 ? visibleFindings.map((finding) => <button className="finding-row" key={finding.key} onClick={() => setSelectedFinding(finding)} role="row"><span className="finding-main"><span className={`row-severity ${finding.severity === "severe" ? "serious" : "minor"}`} /><span className="finding-copy"><strong>{finding.comment}</strong><small>{finding.file}{finding.line > 0 ? `:${finding.line}` : ""} <i /> {shortCommit(finding.commit)}</small></span></span><span className="finding-repo"><span className="source-tag code">Code</span><span>{finding.repoName}</span></span><span><span className={`severity-pill ${finding.severity === "severe" ? "serious" : "minor"}`}>{finding.severity}</span></span><span className="finding-age">{displayDate(finding.scannedAt)}</span><span className="row-arrow" aria-hidden="true">↗</span></button>) : <div className="empty-state">{search ? "No findings match this search." : "No findings in the latest scans for this view."}</div>}
            </div><div className="findings-footer"><span>{visibleFindings.length} findings from latest scans</span><span className="findings-footer-note">Select a finding to inspect its comment and suggested fix.</span></div>
          </section>
          <footer className="page-footer"><span>Otto security intelligence</span><span><i /> Scan results are advisory and tied to the selected repository.</span></footer>
        </div>
      </main>

      {setupOpen && <div className="dialog-backdrop" onClick={() => !setupBusy && setSetupOpen(false)}><section className="finding-dialog setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title" onClick={(event) => event.stopPropagation()}><div className="dialog-top"><span className="section-kicker">GITHUB REPOSITORY</span><button onClick={() => setSetupOpen(false)} aria-label="Close repository setup" disabled={setupBusy}>×</button></div><h2 id="setup-title">Connect a GitHub repository</h2><p className="setup-intro">Paste a public HTTPS repository URL. GitHub OAuth and private repository access are not configured.</p>{setupError && <div className="form-error" role="alert">{setupError}</div>}
        <form onSubmit={handleSetup} className="setup-form"><label>Repository URL<input name="url" type="url" required placeholder="https://github.com/owner/repository" pattern="https://(github\.com|gitlab\.com|bitbucket\.org)/[\w.-]+/[\w.-]+(\.git)?" /></label><label>Display name <span className="optional-label">OPTIONAL</span><input name="name" type="text" placeholder="Uses repository name by default" /></label><label className="consent-check"><input type="checkbox" checked={setupConsent} onChange={(event) => setSetupConsent(event.target.checked)} required /><span>I own or am authorized to assess this repository. I understand Otto clones its source and sends source files to the configured Gemini API to generate project context.</span></label><button className="auth-submit" disabled={setupBusy || !setupConsent}>{setupBusy ? "Connecting repository..." : "Connect repository"}</button></form>
      </section></div>}

      {selectedFinding && <div className="dialog-backdrop" onClick={() => setSelectedFinding(null)}><section className="finding-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(event) => event.stopPropagation()}><div className="dialog-top"><span className={`severity-pill ${selectedFinding.severity === "severe" ? "serious" : "minor"}`}>{selectedFinding.severity}</span><button onClick={() => setSelectedFinding(null)} aria-label="Close finding details">×</button></div><div className="dialog-id">{selectedFinding.repoName} <i /> commit {shortCommit(selectedFinding.commit)}</div><h2 id="dialog-title">{selectedFinding.comment}</h2><p className="dialog-location">{selectedFinding.file}{selectedFinding.line > 0 ? `:${selectedFinding.line}` : ""}</p><div className="dialog-section"><span className="section-kicker">SCAN FINDING</span><p>{selectedFinding.comment}</p></div>{selectedFinding.fix && <div className="otto-suggestion"><div className="otto-suggestion-heading"><span className="brand-mark small-mark">o</span><strong>Suggested fix</strong><span>REVIEW</span></div><p>{selectedFinding.fix}</p><small>Review the suggestion and verify it against your code and policy before applying it.</small></div>}<button className="dialog-done" onClick={() => setSelectedFinding(null)}>Done</button></section></div>}
    </div>
  );
}
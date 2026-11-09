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
  signOut,
  applyFix,
  type ApiFinding,
  type ApiRepo,
  type ApiRepoDetail,
  type GitHubRepo,
  type ScanHistoryPoint,
  targetPortScan,
  targetApiScan,
} from "./otto-api";
import Topbar from "./components/topbar";
import Sidebar from "./components/sidebar";
import SummaryCards from "./components/summary-cards";
import ActivityChart from "./components/activity-chart";
import ExposureBreakdown from "./components/exposure-breakdown";
import FindingsTable, { type DisplayFinding } from "./components/findings-table";
import TargetScanPanel from "./components/target-scan-panel";
import ConnectRepoModal from "./components/connect-repo-modal";
import FindingDialog from "./components/finding-dialog";
import LoginView from "./components/login-view";
import DocsView from "./components/docs-view";
import { CheckIcon, CloseIcon, PlayIcon, RefreshIcon } from "./components/icons";

type WorkspaceData = {
  repos: ApiRepo[];
  details: Record<string, ApiRepoDetail>;
};

function createPreviewWorkspace(): WorkspaceData {
  const now = new Date();
  const dates = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now.getTime() - (13 - index) * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  });
  const scanAt = now.toISOString();
  const repos: ApiRepo[] = [
    {
      id: "preview-storefront",
      name: "storefront-api",
      url: "https://github.com/acme/storefront-api",
      githubFullName: "acme/storefront-api",
      lastScan: { status: "fail", counts: { serious: 2, minor: 4 }, at: scanAt },
    },
    {
      id: "preview-billing",
      name: "billing-worker",
      url: "https://github.com/acme/billing-worker",
      githubFullName: "acme/billing-worker",
      lastScan: { status: "pass", counts: { serious: 0, minor: 0 }, at: scanAt },
    },
  ];
  const historyFor = (serious: number[], minor: number[]): ScanHistoryPoint[] =>
    dates.map((date, index) => ({
      date,
      serious: serious[index],
      minor: minor[index],
      scans: index % 4 === 0 ? 2 : 1,
    }));
  const finding: ApiFinding = {
    file: "src/auth/session.ts",
    line: 42,
    severity: "serious",
    title: "Session token is not rotated",
    comment: "A reused token can remain valid longer than intended.",
    fix: "Rotate the session token after privilege changes.",
    ruleId: "AUTH-014",
    source: "deterministic",
  };

  return {
    repos,
    details: {
      "preview-storefront": {
        repo: {
          id: repos[0].id,
          name: repos[0].name,
          url: repos[0].url,
          branch: "main",
          githubFullName: repos[0].githubFullName,
          lastScannedCommit: "a1b2c3d4e5f6",
        },
        current: {
          status: "fail",
          counts: { serious: 2, minor: 4 },
          findings: [
            finding,
            {
              ...finding,
              file: "src/routes/orders.ts",
              line: 118,
              title: "Missing order ownership check",
              comment: "Order access should verify that the authenticated user owns the requested order.",
              fix: "Check the order owner before returning its data.",
              ruleId: "AUTHZ-003",
              source: "ai",
            },
            {
              ...finding,
              file: "src/config.ts",
              line: 27,
              severity: "minor",
              title: "Verbose error detail returned",
              comment: "Error responses may reveal implementation details.",
              fix: "Return a generic client error and log details server-side.",
              ruleId: "ERR-006",
            },
          ],
          scannedAt: scanAt,
          commit: "a1b2c3d4e5f6",
        },
        history: historyFor(
          [1, 2, 2, 3, 2, 2, 1, 2, 3, 2, 1, 2, 2, 2],
          [4, 3, 4, 5, 4, 6, 5, 4, 3, 4, 5, 4, 4, 4],
        ),
      },
      "preview-billing": {
        repo: {
          id: repos[1].id,
          name: repos[1].name,
          url: repos[1].url,
          branch: "main",
          githubFullName: repos[1].githubFullName,
          lastScannedCommit: "f6e5d4c3b2a1",
        },
        current: {
          status: "pass",
          counts: { serious: 0, minor: 0 },
          findings: [],
          scannedAt: scanAt,
          commit: "f6e5d4c3b2a1",
        },
        history: historyFor(
          [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [1, 2, 2, 2, 1, 2, 1, 1, 2, 1, 1, 1, 0, 0],
        ),
      },
    },
  };
}

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

function displayDate(value?: string | null) {
  if (!value) return "Not yet scanned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ConnectedPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [scanSuccess, setScanSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const [timelineDates, setTimelineDates] = useState<string[]>([]);

  useEffect(() => {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 13; i >= 0; i--) {
      dates.push(new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    setTimelineDates(dates);
  }, []);

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
  const [activeView, setActiveView] = useState<"overview" | "repositories" | "target" | "docs">("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pageError, setPageError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [targetHost, setTargetHost] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiSpec, setApiSpec] = useState("");
  const [targetAuthorized, setTargetAuthorized] = useState(false);
  const [targetFindings, setTargetFindings] = useState<ApiFinding[]>([]);
  const [targetSummary, setTargetSummary] = useState("");
  const [targetBusy, setTargetBusy] = useState<"port" | "api" | null>(null);
  const [targetError, setTargetError] = useState("");

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState<string | null>(null);
  const [setupError, setSetupError] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [loadingGhRepos, setLoadingGhRepos] = useState(false);

  const [selectedFinding, setSelectedFinding] = useState<DisplayFinding | null>(null);
  const [applyingFix, setApplyingFix] = useState(false);
  const [fixResult, setFixResult] = useState<{ number: number; html_url: string; title: string } | null>(null);
  const [fixError, setFixError] = useState("");
  const [createdPRs, setCreatedPRs] = useState<Record<string, { number: number; html_url: string; title: string }>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("otto-created-prs");
      if (saved) setCreatedPRs(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let active = true;

    const isPreview =
      process.env.NODE_ENV === "development" &&
      new URLSearchParams(window.location.search).get("preview") === "1";
    if (isPreview) {
      Promise.resolve().then(() => {
        if (!active) return;
        setPreviewMode(true);
        setToken("preview");
        setUserEmail("demo@example.com");
        setUserName("Demo workspace");
        setWorkspace(createPreviewWorkspace());
        setAuthReady(true);
      });
      return () => {
        active = false;
      };
    }

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
        window.localStorage.setItem("otto-token", hashToken);
        window.localStorage.setItem("otto-email", hashEmail);
        window.localStorage.setItem("otto-name", hashName);
        window.localStorage.setItem("otto-avatar", hashAvatar);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }

    Promise.resolve().then(async () => {
      const savedToken =
        window.sessionStorage.getItem("otto-token") ||
        window.localStorage.getItem("otto-token");
      const savedEmail =
        window.sessionStorage.getItem("otto-email") ||
        window.localStorage.getItem("otto-email") ||
        "";
      const savedName =
        window.sessionStorage.getItem("otto-name") ||
        window.localStorage.getItem("otto-name") ||
        savedEmail.split("@")[0];
      const savedAvatar =
        window.sessionStorage.getItem("otto-avatar") ||
        window.localStorage.getItem("otto-avatar") ||
        "";

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
        const msg = error instanceof Error ? error.message.toLowerCase() : "";
        const isExpired = msg.includes("invalid or expired token") || msg.includes("unauthorized") || msg.includes("401");
        if (isExpired) {
          window.sessionStorage.removeItem("otto-token");
          window.sessionStorage.removeItem("otto-email");
          window.sessionStorage.removeItem("otto-name");
          window.sessionStorage.removeItem("otto-avatar");
          window.localStorage.removeItem("otto-token");
          window.localStorage.removeItem("otto-email");
          window.localStorage.removeItem("otto-name");
          window.localStorage.removeItem("otto-avatar");
          if (active) {
            setToken(null);
            setAuthError(error instanceof Error ? error.message : "Unable to load workspace.");
          }
        } else {
          console.warn("[Otto] Non-auth workspace load failure:", error);
          if (active) {
            setPageError(error instanceof Error ? error.message : "Unable to reach workspace backend.");
          }
        }
      } finally {
        if (active) setAuthReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!setupOpen || !token) return;
    setLoadingGhRepos(true);
    setSetupError("");
    getGitHubRepos(token)
      .then((data) => {
        setGithubRepos(data.repos);
      })
      .catch((err) => {
        setGithubRepos([]);
        setSetupError(err.message || "Failed to load GitHub repositories.");
      })
      .finally(() => {
        setLoadingGhRepos(false);
      });
  }, [setupOpen, token]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selectedFinding) setSelectedFinding(null);
        else if (setupOpen && !setupBusy) setSetupOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedFinding, setupOpen, setupBusy]);

  const repos = workspace?.repos ?? [];
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedName = selectedRepo?.name ?? "All repositories";
  const scopedRepos = selectedRepo ? [selectedRepo] : repos;

  const breadcrumbName =
    activeView === "overview"
      ? "Overview"
      : activeView === "target"
      ? "Penetration Testing"
      : activeView === "docs"
      ? "Documentation"
      : selectedRepo
      ? selectedRepo.name
      : "Repositories";

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

  const sortedDates = [...timelineDates].sort();
  const repoTimelines = new Map<string, Map<string, { serious: number; minor: number; scans: number }>>();

  for (const repo of scopedRepos) {
    const detail = workspace?.details[repo.id];
    const history = detail?.history ?? [];
    const historyByDate = new Map(history.map((h) => [h.date, h]));

    if (detail?.current && detail.current.scannedAt) {
      const curDate = detail.current.scannedAt.slice(0, 10);
      if (!historyByDate.has(curDate)) {
        historyByDate.set(curDate, {
          date: curDate,
          serious: detail.current.counts.serious,
          minor: detail.current.counts.minor,
          scans: 1,
        });
      }
    }

    let lastKnownSerious = repo.lastScan?.counts.serious ?? 0;
    let lastKnownMinor = repo.lastScan?.counts.minor ?? 0;
    let hasScanned = false;

    const allScanPoints = Array.from(historyByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (allScanPoints.length > 0) {
      lastKnownSerious = allScanPoints[0].serious;
      lastKnownMinor = allScanPoints[0].minor;
      hasScanned = true;
    }

    const repoMap = new Map<string, { serious: number; minor: number; scans: number }>();
    for (const d of sortedDates) {
      const dayScan = historyByDate.get(d);
      if (dayScan) {
        lastKnownSerious = dayScan.serious;
        lastKnownMinor = dayScan.minor;
        hasScanned = true;
        repoMap.set(d, { serious: lastKnownSerious, minor: lastKnownMinor, scans: dayScan.scans });
      } else if (hasScanned) {
        repoMap.set(d, { serious: lastKnownSerious, minor: lastKnownMinor, scans: 0 });
      } else {
        repoMap.set(d, { serious: 0, minor: 0, scans: 0 });
      }
    }
    repoTimelines.set(repo.id, repoMap);
  }

  const chartHistory: ScanHistoryPoint[] = sortedDates.map((d) => {
    let serious = 0;
    let minor = 0;
    let scans = 0;
    for (const repo of scopedRepos) {
      const dayData = repoTimelines.get(repo.id)?.get(d);
      if (dayData) {
        serious += dayData.serious;
        minor += dayData.minor;
        scans += dayData.scans;
      }
    }
    return { date: d, serious, minor, scans };
  });

  const rawMax = Math.max(0, ...chartHistory.flatMap((point) => [point.serious, point.minor]));
  const chartMaximum = Math.max(4, rawMax);

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

  const visibleFindings = allFindings;

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
      if (message.toLowerCase().includes("invalid or expired token") || message.includes("401")) {
        handleSignOut();
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function runTargetPortScan() {
    if (!token || targetBusy !== null) return;
    if (!targetAuthorized) return setTargetError("Confirm you are authorized to scan this target.");
    if (!targetHost.trim()) return setTargetError("Enter a host or IP.");
    setTargetBusy("port");
    setTargetError("");
    try {
      const result = await targetPortScan(token, targetHost.trim(), true);
      setTargetFindings(result.findings);
      setTargetSummary(result.summary);
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : "Port scan failed.");
    } finally {
      setTargetBusy(null);
    }
  }

  async function runTargetApiScan() {
    if (!token || targetBusy !== null) return;
    if (!targetAuthorized) return setTargetError("Confirm you are authorized to test this API.");
    if (!apiSpec.trim()) return setTargetError("Paste an OpenAPI JSON spec.");
    setTargetBusy("api");
    setTargetError("");
    try {
      const result = await targetApiScan(token, apiBaseUrl.trim(), apiSpec, true);
      setTargetFindings(result.findings);
      setTargetSummary(result.summary);
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : "API scan failed.");
    } finally {
      setTargetBusy(null);
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

  async function handleApplyFix() {
    if (!token || !selectedFinding || !selectedFinding.fix || applyingFix) return;
    setApplyingFix(true);
    setFixError("");
    setFixResult(null);

    try {
      const repoFindings = workspace?.details[selectedFinding.repoId]?.current?.findings ?? [];
      const findingIndex = repoFindings.findIndex(
        (f) => f.ruleId === selectedFinding.ruleId && f.file === selectedFinding.file && f.line === selectedFinding.line
      );
      const res = await applyFix(token, selectedFinding.repoId, findingIndex >= 0 ? findingIndex : 0);
      if (res.pullRequests && res.pullRequests.length > 0) {
        const pr = res.pullRequests[0];
        setFixResult(pr);
        const fKey = `${selectedFinding.repoId}:${selectedFinding.file}:${selectedFinding.ruleId}:${selectedFinding.line}`;
        setCreatedPRs((prev) => {
          const next = { ...prev, [fKey]: pr };
          try {
            window.localStorage.setItem("otto-created-prs", JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      } else {
        setFixError("No pull request could be created.");
      }
    } catch (err: any) {
      setFixError(err.message || "Failed to create fix PR.");
    } finally {
      setApplyingFix(false);
    }
  }

  useEffect(() => {
    setFixResult(null);
    setFixError("");
  }, [selectedFinding]);

  async function handleConnectRepo(fullName: string) {
    if (!token) return;
    setSetupBusy(fullName);
    setSetupError("");
    try {
      const res = await connectRepo(token, fullName);
      const updated = await loadWorkspace(token);
      setWorkspace(updated);
      if (res && res.id) {
        setSelectedRepoId(res.id);
        setActiveView("repositories");
      }
      setSetupOpen(false);
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 4500);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to connect repository.");
    } finally {
      setSetupBusy(null);
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

  async function handleSignOut() {
    if (token) {
      try {
        await signOut(token);
      } catch {
        /* best effort signout */
      }
    }
    window.sessionStorage.removeItem("otto-token");
    window.sessionStorage.removeItem("otto-email");
    window.sessionStorage.removeItem("otto-name");
    window.sessionStorage.removeItem("otto-avatar");
    window.localStorage.removeItem("otto-token");
    window.localStorage.removeItem("otto-email");
    window.localStorage.removeItem("otto-name");
    window.localStorage.removeItem("otto-avatar");
    setToken(null);
    setWorkspace(null);
    setSelectedRepoId(null);
    setPageError("");
  }

  if (!authReady) {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="auth-spinner" aria-hidden="true" />
        <span className="auth-loading-label">
          Loading Otto
          <span className="auth-loading-dots" aria-hidden="true">
            <span>.</span><span>.</span><span>.</span>
          </span>
        </span>
      </div>
    );
  }

  if (!token || !workspace) {
    return (
      <LoginView
        theme={theme}
        authError={authError}
        onToggleTheme={toggleTheme}
        onGitHubLogin={handleGitHubLogin}
      />
    );
  }

  return (
    <div className="dashboard" data-theme={theme}>
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        userAvatar={userAvatar}
        previewMode={previewMode}
        repos={repos}
        selectedRepoId={selectedRepoId}
        activeView={activeView}
        allFindingsCount={allFindings.length}
        targetFindingsCount={targetFindings.length}
        onSelectView={setActiveView}
        onSelectRepo={(id) => {
          setSelectedRepoId(id);
          if (id !== null) setActiveView("repositories");
        }}
        onOpenConnectModal={() => {
          setSetupError("");
          setSetupOpen(true);
        }}
        onSignOut={handleSignOut}
        isMobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className="main-area" id="overview">
        <Topbar
          selectedName={breadcrumbName}
          theme={theme}
          previewMode={previewMode}
          onToggleTheme={toggleTheme}
          onSignOut={handleSignOut}
          onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
        />

        {scanSuccess && (
          <div className="scan-success-overlay" role="status" aria-live="polite">
            <div className="scan-success-box">
              <div className="scan-success-icon" aria-hidden="true">
                <CheckIcon className="w-4 h-4" />
              </div>
              <div>
                <strong>Operation completed</strong>
                <p>Repository status and security findings updated.</p>
              </div>
              <button
                className="scan-success-close"
                onClick={() => setScanSuccess(false)}
                aria-label="Dismiss notification"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="page-content">
          {/* Active Operation Progress Banner */}
          {setupBusy && (
            <div className="active-loading-banner" role="status">
              <div className="loading-spinner-ring" />
              <div className="loading-banner-text">
                <strong>Connecting repository:</strong> Linking <code>{setupBusy}</code> and publishing initial vulnerability findings...
              </div>
            </div>
          )}
          {scanning && (
            <div className="active-loading-banner" role="status">
              <div className="loading-spinner-ring" />
              <div className="loading-banner-text">
                <strong>Scanning repository:</strong> Analyzing <code>{selectedRepo?.name}</code> with Gemini AI...
              </div>
            </div>
          )}
          {targetBusy && (
            <div className="active-loading-banner" role="status">
              <div className="loading-spinner-ring" />
              <div className="loading-banner-text">
                <strong>{targetBusy === "port" ? "Port Scan" : "API Spec Scan"} running:</strong> Probing network targets...
              </div>
            </div>
          )}
          {refreshing && (
            <div className="active-loading-banner" role="status">
              <div className="loading-spinner-ring" />
              <div className="loading-banner-text">
                <strong>Refreshing workspace...</strong> Updating security findings...
              </div>
            </div>
          )}

          {pageError && (
            <div className="page-error" role="alert">
              {pageError}
              <button onClick={() => setPageError("")} aria-label="Dismiss error">
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* VIEW 1: OVERVIEW */}
          {activeView === "overview" && (
            <>
              <section className="page-heading" id="overview">
                <div>
                  <h1>Overview</h1>
                </div>
              </section>

              <SummaryCards
                seriousCount={latestCounts.serious}
                minorCount={latestCounts.minor}
              />

              <section className="analytics-grid" id="activity">
                <ActivityChart
                  chartHistory={chartHistory}
                  chartMaximum={chartMaximum}
                  selectedName={selectedName}
                />
                <ExposureBreakdown
                  seriousCount={latestCounts.serious}
                  minorCount={latestCounts.minor}
                  passingRepoCount={passingRepos}
                  repoCount={scopedRepos.length}
                />
              </section>

              <FindingsTable
                findings={visibleFindings}
                onSelectFinding={setSelectedFinding}
              />
            </>
          )}

          {/* VIEW 2: REPOSITORIES */}
          {activeView === "repositories" && (
            <>
              {selectedRepo ? (
                <>
                  <section className="page-heading" id="repo-detail">
                    <div>
                      <div style={{ marginBottom: "6px" }}>
                        <button
                          type="button"
                          onClick={() => setSelectedRepoId(null)}
                          className="heading-label-btn"
                          style={{ fontSize: "10px", color: "var(--muted)" }}
                        >
                          All repositories
                        </button>
                      </div>
                      <h1>{selectedRepo.name}</h1>
                      <p className="page-sub">
                        {selectedRepo.githubFullName || selectedRepo.url} (branch: {workspace?.details[selectedRepo.id]?.repo.branch ?? "HEAD"})
                      </p>
                    </div>
                    <div className="scan-status">
                      <button
                        className="scan-trigger"
                        disabled={scanning}
                        onClick={() => handleTriggerScan(selectedRepo.id)}
                        aria-label="Scan repository now"
                      >
                        <PlayIcon className="w-3 h-3 inline-block mr-1" />
                        {scanning ? "Scanning..." : "Scan now"}
                      </button>
                      <button
                        className="refresh-button"
                        title="Disconnect repository"
                        style={{ color: "var(--serious)" }}
                        onClick={() => handleDisconnectRepo(selectedRepo.id)}
                        aria-label="Disconnect repository"
                      >
                        <CloseIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="scan-status-dot" aria-hidden="true" />
                      <span>
                        Latest scan: <strong>{displayDate(latestScanDate)}</strong>
                      </span>
                      <button
                        className="refresh-button"
                        aria-label="Refresh workspace data"
                        title="Refresh from backend"
                        disabled={refreshing}
                        onClick={refreshWorkspace}
                      >
                        <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </section>

                  <SummaryCards
                    seriousCount={latestCounts.serious}
                    minorCount={latestCounts.minor}
                  />

                  <section className="analytics-grid" id="activity">
                    <ActivityChart
                      chartHistory={chartHistory}
                      chartMaximum={chartMaximum}
                      selectedName={selectedName}
                    />
                    <ExposureBreakdown
                      seriousCount={latestCounts.serious}
                      minorCount={latestCounts.minor}
                      passingRepoCount={passingRepos}
                      repoCount={scopedRepos.length}
                    />
                  </section>

                  <FindingsTable
                    findings={visibleFindings}
                    onSelectFinding={setSelectedFinding}
                  />
                </>
              ) : (
                <>
                  <section className="page-heading" id="repos-overview">
                    <div>
                      <h1>Repositories</h1>
                      <p className="page-sub">{repos.length} repositories</p>
                    </div>
                    <div className="scan-status">
                      <button
                        className="scan-trigger"
                        onClick={() => {
                          setSetupError("");
                          setSetupOpen(true);
                        }}
                      >
                        + Connect repository
                      </button>
                      <button
                        className="refresh-button"
                        aria-label="Refresh workspace data"
                        title="Refresh from backend"
                        disabled={refreshing}
                        onClick={refreshWorkspace}
                      >
                        <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </section>

                  <div className="repos-card-grid">
                    {repos.map((repo) => {
                      const detail = workspace?.details[repo.id];
                      const counts = repo.lastScan?.counts ?? { serious: 0, minor: 0 };
                      const total = counts.serious + counts.minor;
                      return (
                        <div key={repo.id} className="repo-summary-card">
                          <div className="repo-card-top">
                            <div className="repo-card-title">
                              <span>{repo.name}</span>
                            </div>
                            <span className={`severity-pill ${total > 0 ? "serious" : "minor"}`}>
                              {total > 0 ? `${total} reports` : "clean"}
                            </span>
                          </div>
                          <div className="repo-card-meta">
                            <div>{repo.githubFullName || repo.url}</div>
                            <div style={{ marginTop: "4px" }}>
                              Commit: <code>{detail?.repo.lastScannedCommit?.slice(0, 7) || "None"}</code> · {displayDate(detail?.current?.scannedAt || repo.lastScan?.at)}
                            </div>
                          </div>
                          <div className="repo-card-actions">
                            <button
                              className="scan-trigger"
                              onClick={() => {
                                setSelectedRepoId(repo.id);
                                setActiveView("repositories");
                              }}
                            >
                              View details
                            </button>
                            <button
                              className="scan-trigger"
                              disabled={scanning}
                              onClick={() => handleTriggerScan(repo.id)}
                            >
                              Scan now
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <FindingsTable
                    findings={visibleFindings}
                    onSelectFinding={setSelectedFinding}
                  />
                </>
              )}
            </>
          )}

          {/* VIEW 3: PENETRATION TESTING */}
          {activeView === "target" && (
            <>
              <section className="page-heading" id="target">
                <div>
                  <h1>Penetration Testing</h1>
                  <p className="page-sub">
                    Port exposure probes and OpenAPI specification compliance testing
                  </p>
                </div>
              </section>

              <TargetScanPanel
                targetAuthorized={targetAuthorized}
                targetHost={targetHost}
                apiBaseUrl={apiBaseUrl}
                apiSpec={apiSpec}
                targetBusy={targetBusy}
                targetError={targetError}
                targetSummary={targetSummary}
                targetFindings={targetFindings}
                onAuthorizeChange={setTargetAuthorized}
                onTargetHostChange={setTargetHost}
                onApiBaseUrlChange={setApiBaseUrl}
                onApiSpecChange={setApiSpec}
                onRunPortScan={runTargetPortScan}
                onRunApiScan={runTargetApiScan}
              />
            </>
          )}

          {/* VIEW 4: DOCUMENTATION */}
          {activeView === "docs" && (
            <DocsView />
          )}
        </div>
      </main>

      <ConnectRepoModal
        isOpen={setupOpen}
        setupBusy={setupBusy}
        setupError={setupError}
        loadingGhRepos={loadingGhRepos}
        githubRepos={githubRepos}
        onClose={() => setSetupOpen(false)}
        onConnectRepo={handleConnectRepo}
        onAuthorizeGitHub={handleGitHubLogin}
      />

      <FindingDialog
        finding={selectedFinding}
        applyingFix={applyingFix}
        fixResult={fixResult}
        existingPR={
          selectedFinding
            ? createdPRs[`${selectedFinding.repoId}:${selectedFinding.file}:${selectedFinding.ruleId}:${selectedFinding.line}`]
            : null
        }
        fixError={fixError}
        onClose={() => setSelectedFinding(null)}
        onApplyFix={handleApplyFix}
      />
    </div>
  );
}

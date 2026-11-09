const API_BASE_URL = (process.env.NEXT_PUBLIC_OTTO_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export type ScanStatus = "pass" | "fail" | "error";

export type ApiFinding = {
  file: string;
  line: number;
  severity: "serious" | "minor" | "info";
  title: string;
  comment: string;
  fix: string;
  ruleId: string;
  source: "deterministic" | "ai";
};

export type ApiRepo = {
  id: string;
  name: string;
  url: string;
  githubFullName: string;
  lastScan: null | {
    status: ScanStatus;
    counts: { serious: number; minor: number };
    at: string;
  };
};

export type GitHubRepo = {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string;
  connected: boolean;
  ottoRepoId?: string;
};

export type ScanHistoryPoint = {
  date: string;
  serious: number;
  minor: number;
  scans: number;
};

export type ApiRepoDetail = {
  repo: {
    id: string;
    name: string;
    url: string;
    branch: string;
    githubFullName: string;
    lastScannedCommit: string | null;
    webhookSecret?: string;
  };
  current: null | {
    status: ScanStatus;
    counts: { serious: number; minor: number };
    findings: ApiFinding[];
    scannedAt: string;
    commit: string;
  };
  history: ScanHistoryPoint[];
};

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Bypass ngrok free tier browser warning interstitial for all API calls
  headers.set("ngrok-skip-browser-warning", "true");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Otto API returned ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

// Auth
export async function getGitHubAuthTarget(): Promise<string> {
  try {
    const res = await request<{ url: string }>("/auth/github");
    if (res?.url) return res.url;
  } catch {
    /* fallback to direct navigation */
  }
  return `${API_BASE_URL}/auth/github`;
}

export function getGitHubAuthUrl() {
  return `${API_BASE_URL}/auth/github`;
}

// Repos
export function getRepositories(token: string) {
  return request<{ repos: ApiRepo[] }>("/repos", token);
}

export function getGitHubRepos(token: string) {
  return request<{ repos: GitHubRepo[] }>("/repos/github", token);
}

export function connectRepo(token: string, fullName: string, name?: string) {
  return request<{ id: string; name: string; filesIngested: number; commit: string }>("/repos/connect", token, {
    method: "POST",
    body: JSON.stringify({ fullName, name }),
  });
}

export function disconnectRepo(token: string, repoId: string) {
  return request<{}>(`/repos/${encodeURIComponent(repoId)}`, token, { method: "DELETE" });
}

export function getRepository(id: string, token: string) {
  return request<ApiRepoDetail>(`/repos/${encodeURIComponent(id)}`, token);
}

export function triggerScan(token: string, repoId: string) {
  return request<{ status: string; commit: string; findings?: ApiFinding[] }>(`/repos/${encodeURIComponent(repoId)}/scan`, token, { method: "POST" });
}

// Ad-hoc target scans
export function targetPortScan(token: string, host: string, authorized: boolean) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  return request<{ findings: ApiFinding[]; summary: string }>("/target/port-scan", token, {
    method: "POST",
    body: JSON.stringify({ host, authorized }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
}

export function targetApiScan(token: string, baseUrl: string, spec: string, authorized: boolean) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  return request<{ findings: ApiFinding[]; summary: string }>("/target/api-scan", token, {
    method: "POST",
    body: JSON.stringify({ baseUrl, spec, authorized }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
}

export function signOut(token: string) {
  return request<{ ok: boolean }>("/auth/signout", token, { method: "POST" });
}

export function applyFix(token: string, repoId: string, findingIndex: number) {
  return request<{ pullRequests: Array<{ number: number; html_url: string; title: string }> }>(
    `/repos/${encodeURIComponent(repoId)}/apply-fix`,
    token,
    { method: "POST", body: JSON.stringify({ findingIndex }) },
  );
}

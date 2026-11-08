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

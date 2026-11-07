const API_BASE_URL = (process.env.NEXT_PUBLIC_OTTO_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export type ScanStatus = "pass" | "fail" | "error";

export type ApiFinding = {
  file: string;
  line: number;
  severity: "severe" | "minor";
  comment: string;
  fix: string;
};

export type ApiRepo = {
  id: string;
  name: string;
  url: string;
  lastScan: null | {
    status: ScanStatus;
    counts: { severe: number; minor: number };
    at: string;
  };
};

export type ScanHistoryPoint = {
  date: string;
  severe: number;
  minor: number;
  scans: number;
};

export type ApiRepoDetail = {
  repo: {
    id: string;
    name: string;
    url: string;
    branch: string;
    lastScannedCommit: string | null;
  };
  current: null | {
    status: ScanStatus;
    counts: { severe: number; minor: number };
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

export function authenticate(email: string, password: string) {
  return request<{ token: string; user: { id: string; email: string } }>("/auth", undefined, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getRepositories(token: string) {
  return request<{ repos: ApiRepo[] }>("/repos", token);
}

export function getRepository(id: string, token: string) {
  return request<ApiRepoDetail>(`/repos/${encodeURIComponent(id)}`, token);
}

export function addRepository(token: string, body: { url: string; name?: string }) {
  return request<{ id: string; name: string; filesIngested: number; commit: string }>("/setup", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
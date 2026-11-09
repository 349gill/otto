import { exec } from "./git.js";
import type { Finding } from "./models.js";

// Backing services considered sensitive when open to external traffic.
const SENSITIVE: Record<number, string> = {
  22: "ssh", 23: "telnet", 2375: "docker-api", 2376: "docker-api-tls",
  3306: "mysql", 5432: "postgres", 5984: "couchdb", 6379: "redis",
  9200: "elasticsearch", 11211: "memcached", 27017: "mongodb",
  27018: "mongodb", 27019: "mongodb",
};

export type TargetScanResult = { findings: Finding[]; summary: string };

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;
const PRIVATE_OK = true;

export function validHost(host: string): boolean {
  return HOST_RE.test(host) && !host.includes("..");
}

function parseGreppable(out: string): { port: number; service: string }[] {
  const open: { port: number; service: string }[] = [];
  const m = out.match(/Ports:\s*(.+)/);
  if (!m) return open;
  for (const part of m[1].split(",")) {
    const pm = part.trim().match(/^(\d+)\/open\/tcp\/\/([^/]*)/);
    if (pm) open.push({ port: Number(pm[1]), service: pm[2] || "unknown" });
  }
  return open;
}

/**
 * Run a real TCP connect scan against a host/IP using nmap in a throwaway
 * container. Runs only when authorized is true; scanning a host without
 * permission is unauthorized.
 */
export async function portScanTarget(host: string, authorized: boolean): Promise<TargetScanResult> {
  if (!authorized) throw new Error("Not authorized: confirm you own or may test this target.");
  if (!validHost(host)) throw new Error(`Invalid host: ${host}`);

  const highPorts = Object.keys(SENSITIVE).map(Number).filter((p) => p > 10000);
  const portSpec = ["1-10000", ...highPorts].join(",");

  const r = await exec(
    "docker",
    [
      "run", "--rm",
      "--memory", "128m", "--pids-limit", "64",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "instrumentisto/nmap",
      "-Pn", "-sT", "-T4", "--open", "-p", portSpec, "-oG", "-", host,
    ],
    { timeout: 180_000 }
  );

  const open = parseGreppable(r.out);
  const findings: Finding[] = open.map((p): Finding => {
    const sensitive = p.port in SENSITIVE;
    const service = SENSITIVE[p.port] ?? p.service ?? "unknown";
    return {
      file: `${host}:${p.port}`,
      line: 0,
      severity: sensitive ? "serious" : "minor",
      title: sensitive ? `Open sensitive port ${p.port} (${service})` : `Open port ${p.port} (${service})`,
      comment: `Port ${p.port}/tcp (${service}) is open on ${host}.` +
        (sensitive ? " This is a sensitive backing service reachable over the network." : ""),
      fix: sensitive
        ? `Restrict ${service} to a private network / firewall it so it is not reachable from untrusted hosts.`
        : `Confirm this service should be publicly reachable; close it if not needed.`,
      ruleId: sensitive ? "PORT-001" : "PORT-002",
      source: "deterministic",
    };
  });

  const summary = open.length
    ? `Port scan of ${host}: open ${open.map((p) => p.port).join(", ")}.`
    : `Port scan of ${host}: no open ports found in range.`;
  return { findings, summary };
}

type SpecOp = { method: string; path: string; secured: boolean };

function enumerateOps(spec: any): { ops: SpecOp[]; serverUrl: string } {
  const ops: SpecOp[] = [];
  const globalSecured = Array.isArray(spec.security) && spec.security.length > 0;
  const paths = spec.paths ?? {};
  for (const path of Object.keys(paths)) {
    const item = paths[path] ?? {};
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      const secured = Array.isArray(op.security) ? op.security.length > 0 : globalSecured;
      ops.push({ method: method.toUpperCase(), path, secured });
    }
  }
  const serverUrl =
    spec.servers?.[0]?.url ??
    (spec.host ? `${(spec.schemes?.[0] ?? "https")}://${spec.host}${spec.basePath ?? ""}` : "");
  return { ops, serverUrl };
}

// Common paths that should not exist / respond on a well-run API.
const SHADOW_PATHS = ["/.env", "/admin", "/debug", "/actuator", "/swagger.json", "/.git/config"];

/**
 * Probe a live API against its OpenAPI spec. ONLY runs when `authorized` is
 * true. Sends only GET requests (no state-changing calls). Flags endpoints
 * that declare auth but answer 2xx without it, and common shadow paths.
 */
export async function apiSpecScan(baseUrlIn: string, specText: string, authorized: boolean): Promise<TargetScanResult> {
  if (!authorized) throw new Error("Not authorized: confirm you own or may test this API.");

  let spec: any;
  try {
    spec = JSON.parse(specText);
  } catch {
    throw new Error("Spec must be JSON (OpenAPI 3 or Swagger 2). Convert YAML to JSON first.");
  }

  const { ops, serverUrl } = enumerateOps(spec);
  const base = (baseUrlIn || serverUrl).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("A base URL (http/https) is required.");

  const findings: Finding[] = [];
  const getOps = ops.filter((o) => o.method === "GET").slice(0, 30); // cap, GET only

  async function probe(url: string): Promise<number | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
      clearTimeout(t);
      return res.status;
    } catch {
      return null;
    }
  }

  // Spec endpoints: a secured endpoint that returns 2xx with no credentials = broken auth.
  for (const op of getOps) {
    const url = base + op.path.replace(/\{[^}]+\}/g, "1"); // fill path params
    const status = await probe(url);
    if (status === null) continue;
    if (op.secured && status >= 200 && status < 300) {
      findings.push({
        file: `${op.method} ${op.path}`,
        line: 0,
        severity: "serious",
        title: "Authentication not enforced",
        comment: `${op.method} ${op.path} declares a security requirement in the spec but returned ${status} with no credentials: auth is not enforced.`,
        fix: "Enforce the declared authentication/authorization on this endpoint server-side.",
        ruleId: "API-001",
        source: "deterministic",
      });
    }
  }

  // Shadow / sensitive paths that are not in the spec but respond.
  const specPaths = new Set(ops.map((o) => o.path));
  for (const p of SHADOW_PATHS) {
    if (specPaths.has(p)) continue;
    const status = await probe(base + p);
    if (status !== null && status >= 200 && status < 300) {
      findings.push({
        file: `GET ${p}`,
        line: 0,
        severity: "serious",
        title: `Shadow / sensitive path reachable (${p})`,
        comment: `${p} is reachable (HTTP ${status}) but is not part of the API spec: an unexpected or sensitive exposure.`,
        fix: `Remove or protect ${p}; it should not be publicly reachable.`,
        ruleId: "API-002",
        source: "deterministic",
      });
    }
  }

  const summary = `API spec scan of ${base}: probed ${getOps.length} endpoint(s), ${findings.length} finding(s).`;
  return { findings, summary };
}

import type { Finding } from "./models.js";

// Backing services that should never be reachable from outside their private
// network. Finding a published / all-interface binding for one of these is a
// serious exposure.
const SENSITIVE: Record<number, string> = {
  22: "ssh",
  23: "telnet",
  2375: "docker-api",
  2376: "docker-api-tls",
  3306: "mysql",
  5432: "postgres",
  5984: "couchdb",
  6379: "redis",
  9200: "elasticsearch",
  11211: "memcached",
  27017: "mongodb",
  27018: "mongodb",
  27019: "mongodb",
};

const base = (p: string) => p.split("/").pop()?.toLowerCase() ?? "";
const isDockerfile = (p: string) => base(p) === "dockerfile" || base(p).startsWith("dockerfile.");
const isCompose = (p: string) => ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].includes(base(p));
const isConf = (p: string) => base(p).endsWith(".conf");

function finding(
  file: string,
  line: number,
  severity: "serious" | "minor",
  ruleId: string,
  title: string,
  comment: string,
  fix: string
): Finding {
  return { file, line, severity, title, comment, fix, ruleId, source: "deterministic" };
}

/**
 * Static port-exposure scanner.
 *
 * Reads Dockerfiles, docker-compose files and *.conf files and flags backing
 * services (redis, mongo, postgres, ...) that are bound to all interfaces or
 * published to the host — i.e. reachable alongside the app when they should be
 * private. This is the static counterpart to a live port scan: it needs no
 * running container, so it fits straight into the deterministic scan flow.
 */
export function scanExposure(files: { path: string; content: string }[]): Finding[] {
  const out: Finding[] = [];

  for (const f of files) {
    const dockerfile = isDockerfile(f.path);
    const compose = isCompose(f.path);
    const conf = isConf(f.path);
    if (!dockerfile && !compose && !conf) continue;

    f.content.split(/\r?\n/).forEach((raw, i) => {
      const line = i + 1;
      const l = raw.trim();
      const low = l.toLowerCase();
      if (!low || low.startsWith("#")) return;

      // Service bound to every interface (redis --bind 0.0.0.0, mongo bindIp: 0.0.0.0, etc.)
      if (/--?bind(?:_ip|ip)?[\s:=]+0\.0\.0\.0/.test(low)) {
        const svc = low.includes("mongo") ? "mongodb" : low.includes("redis") ? "redis" : "a backing service";
        out.push(
          finding(
            f.path,
            line,
            "serious",
            "PORT-001",
            `Service bound to all interfaces (${svc})`,
            `This binds ${svc} to 0.0.0.0, so it listens on every network interface and is reachable from outside its container/host — a backing service should stay private.`,
            `Bind it to 127.0.0.1 instead, or keep it on an internal-only network and reach it privately from the app.`
          )
        );
      }

      // Redis protected-mode disabled (allows remote unauthenticated access)
      if (/protected-mode\s+no/.test(low)) {
        out.push(
          finding(
            f.path,
            line,
            "serious",
            "PORT-003",
            "Redis protected-mode disabled",
            "`protected-mode no` removes the safeguard that blocks remote unauthenticated access to Redis.",
            "Set `protected-mode yes` and require a password (`requirepass`), or bind Redis to localhost only."
          )
        );
      }

      // Dockerfile EXPOSE of a sensitive service port
      if (dockerfile) {
        const m = low.match(/^expose\s+(.+)/);
        if (m) {
          for (const tok of m[1].split(/[\s,]+/)) {
            const port = Number(tok.split("/")[0]);
            if (SENSITIVE[port]) {
              out.push(
                finding(
                  f.path,
                  line,
                  "serious",
                  "PORT-001",
                  `Exposed backing service port ${port} (${SENSITIVE[port]})`,
                  `The Dockerfile EXPOSEs port ${port} (${SENSITIVE[port]}), a backing data service that should not be reachable alongside the app.`,
                  `Remove this EXPOSE and keep ${SENSITIVE[port]} on an internal network; the app should reach it privately, not over a published port.`
                )
              );
            }
          }
        }
      }

      // docker-compose published ports, e.g.  - "6379:6379"  or  - 27017:27017
      // (a 127.0.0.1-bound mapping is localhost-only, so it is not flagged)
      if (compose && !l.includes("127.0.0.1")) {
        const pm = l.match(/^-?\s*["']?(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):(\d{2,5})(?:\/(?:tcp|udp))?["']?\s*$/);
        if (pm) {
          const hostPort = Number(pm[1]);
          const contPort = Number(pm[2]);
          const svcPort = SENSITIVE[contPort] ? contPort : SENSITIVE[hostPort] ? hostPort : 0;
          if (svcPort) {
            out.push(
              finding(
                f.path,
                line,
                "serious",
                "PORT-001",
                `Published backing service port ${svcPort} (${SENSITIVE[svcPort]})`,
                `This compose file publishes ${SENSITIVE[svcPort]} (port ${svcPort}) to the host, exposing a backing data service outside the private network.`,
                `Drop the published \`ports:\` mapping for ${SENSITIVE[svcPort]} and rely on Docker's internal service network; publish only the app's own port.`
              )
            );
          }
        }
      }
    });
  }

  // De-duplicate identical findings (same rule, file and line).
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.ruleId}:${f.file}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

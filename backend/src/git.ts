import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

// Always execFile (never a shell string) so user input can't inject commands.
export async function exec(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { maxBuffer: 20 * 1024 * 1024, ...opts });
    return { code: 0, out: stdout + stderr };
  } catch (e: any) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      out: (e.stdout ?? "") + (e.stderr ?? "") + (e.killed ? "\n[timed out]" : ""),
    };
  }
}

// https only, public hosts only, no credentials or odd characters in the URL.
const REPO_URL = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+?(\.git)?$/;
export function isValidRepoUrl(url: string): boolean {
  return REPO_URL.test(url);
}

export async function cloneRepo(url: string, branch?: string, token?: string): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "otto-"));
  const args = ["clone", "--depth", "50", "--no-tags"];
  if (branch && branch !== "HEAD" && /^[\w./-]+$/.test(branch)) args.push("--branch", branch);

  let targetUrl = url;
  if (token && url.startsWith("https://github.com/")) {
    const repoPath = url.replace("https://github.com/", "");
    targetUrl = `https://x-access-token:${token}@github.com/${repoPath}`;
  }

  args.push(targetUrl, dir);
  const r = await exec("git", args, { timeout: 120_000 });
  if (r.code !== 0) {
    const safeError = token ? r.out.split(token).join("[REDACTED]").slice(0, 500) : r.out.slice(0, 500);
    throw new Error(`git clone failed: ${safeError}`);
  }
  const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).out.trim();
  return { dir, head };
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d41893a2b4a40e";

// Diff since the last scanned commit. First scan (or commit not in the shallow
// clone) falls back to the entire tree.
export async function getDiff(dir: string, since: string | null): Promise<string> {
  const base = since ?? EMPTY_TREE;
  let r = await exec("git", ["diff", "--unified=3", base, "HEAD"], { cwd: dir });
  if (r.code !== 0) r = await exec("git", ["diff", "--unified=3", EMPTY_TREE, "HEAD"], { cwd: dir });
  return r.out;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "vendor", "venv", "__pycache__", "target"]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".pdf", ".zip", ".gz", ".tar", ".woff",
  ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".lock", ".map", ".min.js", ".exe", ".bin", ".so", ".dll",
]);

// Read source files for the context file. Capped so prompts stay a sane size.
export async function readSource(dir: string, maxTotal = 300_000, maxFile = 40_000) {
  const files: { path: string; content: string }[] = [];
  const tree: string[] = [];
  let total = 0;

  async function walk(d: string) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else {
        tree.push(rel);
        if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
        const size = (await stat(full)).size;
        if (size > maxFile || total + size > maxTotal) continue;
        const content = await readFile(full, "utf8");
        if (content.includes("\u0000")) continue; // binary
        files.push({ path: rel, content });
        total += size;
      }
    }
  }
  await walk(dir);
  return { files, tree };
}
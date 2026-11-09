import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { config } from "./config.js";
import { Repo, Scan, User, oid, type Finding } from "./models.js";
import { gemini, scanWithGemini, stripFences } from "./gemini.js";
import { scanExposure } from "./exposure.js";
import { portScanTarget, apiSpecScan } from "./target.js";
import { cloneRepo, getDiff, readSource, exec } from "./git.js";
import {
  exchangeCodeForToken, getGitHubUser, getGitHubRepos, postPRComment,
  createBranch, createOrUpdateFile, createPullRequest, getDefaultBranch, getFileContent,
} from "./github.js";

type AuthedRequest = Request & { userId?: string };

const app = express();
// Trust proxy (ngrok, cloud load balancers, Cloudflare)
app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning", "X-Otto-Secret", "Accept"],
  })
);
app.use(express.json({ limit: "100kb" }));

// Rate limiters for auth endpoints and resource-heavy operations.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  validate: { xForwardedForHeader: false },
});
const heavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  validate: { xForwardedForHeader: false },
});

// Verify JWT bearer token.
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.userId = (jwt.verify(token, config.jwtSecret) as { sub: string }).sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Redirect to GitHub OAuth flow.
app.get("/auth/github", (_req, res) => {
  if (!config.githubClientId) return res.status(501).json({ error: "GitHub OAuth not configured" });
  const callbackUrl = `${config.backendUrl}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    scope: "repo user:email read:user",
    redirect_uri: callbackUrl,
    state: randomBytes(16).toString("hex"),
  });
  const target = `https://github.com/login/oauth/authorize?${params}`;
  if (_req.headers.accept?.includes("application/json") || _req.query.format === "json") {
    return res.json({ url: target });
  }
  res.redirect(target);
});

// Complete GitHub OAuth exchange.
app.get("/auth/github/callback", authLimiter, async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const accessToken = await exchangeCodeForToken(config.githubClientId, config.githubClientSecret, code);
    const ghUser = await getGitHubUser(accessToken);

    // Upsert user by GitHub ID
    let user = await User.findOne({ githubId: ghUser.id });
    if (!user) {
      user = await User.create({
        githubId: ghUser.id,
        githubLogin: ghUser.login,
        githubToken: accessToken,
        email: ghUser.email || undefined,
        avatarUrl: ghUser.avatar_url,
      });
    } else {
      user.githubToken = accessToken;
      user.githubLogin = ghUser.login;
      user.avatarUrl = ghUser.avatar_url;
      if (ghUser.email && !user.email) user.email = ghUser.email;
      await user.save();
    }

    const token = jwt.sign({ sub: String(user._id) }, config.jwtSecret, { expiresIn: "7d" });
    const fragment = new URLSearchParams({
      token,
      email: user.email || ghUser.email || "",
      name: ghUser.login,
      avatar: ghUser.avatar_url,
    });

    if (req.headers.accept?.includes("application/json") || req.query.format === "json") {
      return res.json({
        token,
        email: user.email || ghUser.email || "",
        name: ghUser.login,
        avatar: ghUser.avatar_url,
      });
    }

    res.redirect(`${config.frontendOrigin}/#${fragment}`);
  } catch (err: any) {
    console.error("GitHub OAuth error:", err);
    if (req.headers.accept?.includes("application/json") || req.query.format === "json") {
      return res.status(400).json({ error: err.message || "OAuth failed" });
    }
    res.redirect(`${config.frontendOrigin}/#error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/auth/signout", requireAuth, async (req: AuthedRequest, res) => {
  const user = await User.findById(req.userId);
  if (user) {
    user.githubToken = "";
    await user.save();
  }
  res.json({ ok: true });
});

app.get("/repos", requireAuth, async (req: AuthedRequest, res) => {
  const repos = await Repo.find({ owner: req.userId }).sort({ updatedAt: -1 }).select("-context");
  const items = await Promise.all(
    repos.map(async (r) => {
      const last = await Scan.findOne({ repo: r._id }).sort({ createdAt: -1 }).select("status counts createdAt");
      return {
        id: r._id,
        name: r.name,
        url: r.url,
        githubFullName: r.githubFullName,
        lastScan: last ? { status: last.status, counts: last.counts, at: (last as any).createdAt } : null,
      };
    })
  );
  res.json({ repos: items });
});

app.get("/repos/github", requireAuth, async (req: AuthedRequest, res) => {
  const user = await User.findById(req.userId);
  if (!user?.githubToken) return res.status(400).json({ error: "No GitHub account linked. Sign in with GitHub first." });

  const ghRepos = await getGitHubRepos(user.githubToken);
  const connected = await Repo.find({ owner: req.userId }).select("githubFullName");
  const connectedMap = new Map(connected.map((r) => [r.githubFullName, String(r._id)]));

  const items = ghRepos.map((r) => ({
    ...r,
    connected: connectedMap.has(r.full_name),
    ottoRepoId: connectedMap.get(r.full_name),
  }));
  res.json({ repos: items });
});

app.post("/repos/connect", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const fullName = String(req.body?.fullName ?? "").trim();
  if (!fullName || !fullName.includes("/")) return res.status(400).json({ error: "fullName is required (owner/repo)" });

  const url = `https://github.com/${fullName}`;
  const name = String(req.body?.name ?? "").trim() || fullName.split("/").pop()!;
  const user = await User.findById(req.userId);

  let dir = "";
  try {
    const cloned = await cloneRepo(url, "HEAD", user?.githubToken);
    dir = cloned.dir;
    const { files, tree } = await readSource(dir);

    let context = "";
    try {
      const sourceDump = files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
      context = await gemini(`Write a context file (markdown) for a security reviewer who has never seen this project.
Include: what the app does, language/framework, entry points, how to install and start it, the port it listens on,
routes/endpoints, auth model, data stores, external services, and any security-sensitive areas.
Be concrete and concise.

File tree:
${tree.join("\n")}

Source:
${sourceDump}`);
    } catch (err) {
      console.error("Gemini context generation failed (continuing without context):", err);
      context = `# ${name}\n\nFiles: ${files.length}\nTree:\n${tree.slice(0, 50).join("\n")}`;
    }

    const repo = await Repo.findOneAndUpdate(
      { owner: req.userId, githubFullName: fullName },
      {
        owner: req.userId,
        url,
        name,
        branch: "HEAD",
        context,
        fileCount: files.length,
        lastScannedCommit: cloned.head,
        githubFullName: fullName,
        webhookSecret: randomBytes(20).toString("hex"),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ id: repo._id, name: repo.name, filesIngested: files.length, commit: cloned.head });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

app.delete("/repos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = oid(req.params.id as string);
  const repo = id && (await Repo.findOneAndDelete({ _id: id, owner: req.userId }));
  if (!repo) return res.status(404).json({ error: "Repo not found" });
  await Scan.deleteMany({ repo: repo._id });
  res.json({ ok: true });
});

app.get("/repos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = oid(req.params.id as string);
  const repo = id && (await Repo.findOne({ _id: id, owner: req.userId }).select("-context"));
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [latest, history] = await Promise.all([
    Scan.findOne({ repo: repo._id }).sort({ createdAt: -1 }),
    Scan.aggregate([
      { $match: { repo: repo._id, createdAt: { $gte: since }, status: { $ne: "error" } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          serious: { $sum: "$counts.serious" },
          minor: { $sum: "$counts.minor" },
          scans: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", serious: 1, minor: 1, scans: 1 } },
    ]),
  ]);

  res.json({
    repo: {
      id: repo._id,
      name: repo.name,
      url: repo.url,
      branch: repo.branch,
      githubFullName: repo.githubFullName,
      lastScannedCommit: repo.lastScannedCommit,
      webhookSecret: repo.webhookSecret,
    },
    current: latest
      ? { status: latest.status, counts: latest.counts, findings: latest.findings, scannedAt: (latest as any).createdAt, commit: latest.commit }
      : null,
    history,
  });
});

// Triggered by CI actions or incoming GitHub webhooks.
app.post("/scan", async (req: AuthedRequest, res, next) => {
  if (req.headers["x-github-event"] === "ping") {
    console.log("[Otto API] Received GitHub webhook ping");
    return res.json({ ok: true, message: "pong" });
  }

  // Authenticate via Bearer JWT, X-Otto-Secret header, or ?secret= query param
  const bearerToken = req.headers.authorization?.replace(/^Bearer /, "");
  const ottoSecret = (req.headers["x-otto-secret"] ?? req.query.secret) as string | undefined;

  // Support both custom payload ({ repoFullName, commitSha, prNumber }) and native GitHub webhook payload
  const repoFullName = String(
    req.body?.repoFullName ?? req.body?.repository?.full_name ?? ""
  ).trim();

  const commitSha = String(
    req.body?.commitSha ??
      req.body?.pull_request?.head?.sha ??
      req.body?.after ??
      req.body?.head_commit?.id ??
      ""
  ).trim();

  const prNumber =
    typeof req.body?.prNumber === "number"
      ? req.body.prNumber
      : typeof req.body?.pull_request?.number === "number"
      ? req.body.pull_request.number
      : null;

  const ref = String(req.body?.ref ?? req.body?.pull_request?.base?.ref ?? "");

  console.log(`\n[Otto API] Webhook scan request received for: ${repoFullName || "unknown"}, commit: ${commitSha.slice(0, 7) || "none"}${prNumber ? `, PR #${prNumber}` : ""}`);

  if (!repoFullName) return res.status(400).json({ error: "repoFullName or repository.full_name is required" });
  if (!commitSha || commitSha === "0000000000000000000000000000000000000000") {
    return res.status(400).json({ error: "commitSha is required" });
  }

  // Find repo
  const repo = await Repo.findOne({ githubFullName: repoFullName });
  if (!repo) {
    console.warn(`[Otto API] Repo ${repoFullName} not found in Otto database.`);
    return res.status(404).json({ error: `Repo ${repoFullName} not connected to Otto` });
  }

  // Auth check
  if (ottoSecret) {
    if (ottoSecret !== repo.webhookSecret) return res.status(401).json({ error: "Invalid webhook secret" });
  } else if (bearerToken) {
    if (bearerToken === repo.webhookSecret) {
      // Authenticated via repo webhook secret
    } else {
      try {
        const payload = jwt.verify(bearerToken, config.jwtSecret) as { sub: string };
        if (String(repo.owner) !== payload.sub) return res.status(403).json({ error: "Not your repo" });
      } catch {
        return res.status(401).json({ error: "Invalid token or secret" });
      }
    }
  } else {
    return res.status(401).json({ error: "Missing authentication" });
  }

  try {
    const result = await performScan(repo, commitSha, prNumber, ref);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const running = new Set<string>();
app.post("/repos/:id/scan", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const id = oid(req.params.id as string);
  const repo = id && (await Repo.findOne({ _id: id, owner: req.userId }));
  if (!repo) return res.status(404).json({ error: "Repo not found" });
  if (running.has(String(repo._id))) return res.status(409).json({ error: "A scan is already running for this repo" });

  console.log(`\n[Otto API] Manual scan triggered via dashboard for: ${repo.name} (${repo.githubFullName || repo.url})`);
  running.add(String(repo._id));
  try {
    const result = await performScan(repo, null, null, null);
    res.json(result);
  } finally {
    running.delete(String(repo._id));
  }
});

app.post("/target/port-scan", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  try {
    const host = String(req.body?.host ?? "").trim();
    const authorized = req.body?.authorized === true;
    if (!host) return res.status(400).json({ error: "host is required" });
    console.log(`\n[Otto API] Live port scan requested for: ${host} (authorized=${authorized})`);
    const result = await portScanTarget(host, authorized);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.post("/target/api-scan", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  try {
    const baseUrl = String(req.body?.baseUrl ?? "").trim();
    const spec = String(req.body?.spec ?? "");
    const authorized = req.body?.authorized === true;
    if (!spec) return res.status(400).json({ error: "spec (OpenAPI JSON) is required" });
    console.log(`\n[Otto API] API spec scan requested for: ${baseUrl || "(from spec servers)"} (authorized=${authorized})`);
    const result = await apiSpecScan(baseUrl, spec, authorized);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

// Ingest code and generate repository architecture context.
app.post("/setup", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const url = String(req.body?.url ?? "").trim();
  const branch = String(req.body?.branch ?? "HEAD");
  if (!url) return res.status(400).json({ error: "url is required" });

  let dir = "";
  try {
    const cloned = await cloneRepo(url, branch);
    dir = cloned.dir;
    const { files, tree } = await readSource(dir);

    let context = "";
    try {
      const sourceDump = files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
      context = await gemini(`Write a context file (markdown) for a security reviewer who has never seen this project.
Include: what the app does, language/framework, entry points, how to install and start it, the port it listens on,
routes/endpoints, auth model, data stores, external services, and any security-sensitive areas.
Be concrete and concise.

File tree:
${tree.join("\n")}

Source:
${sourceDump}`);
    } catch {
      context = `# Project\n\nFiles: ${files.length}`;
    }

    const name = String(req.body?.name ?? url.split("/").slice(-1)[0].replace(/\.git$/, ""));
    const repo = await Repo.findOneAndUpdate(
      { owner: req.userId, url },
      { owner: req.userId, url, name, branch, context, fileCount: files.length, lastScannedCommit: cloned.head },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ id: repo._id, name: repo.name, filesIngested: files.length, commit: cloned.head, context });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

// Core scan pipeline orchestrating clone, static analysis, exposure check, and PR notification.
async function performScan(
  repo: any,
  commitSha: string | null,
  prNumber: number | null,
  ref: string | null,
) {
  let dir = "";
  try {
    console.log(`\n======================================================`);
    console.log(`[Otto Scan] Starting scan for: ${repo.name} (${repo.githubFullName || repo.url})`);
    if (prNumber) console.log(`[Otto Scan] Triggered by Pull Request #${prNumber}`);

    // 1. Clone
    const owner = await User.findById(repo.owner);
    console.log(`[Otto Scan] Cloning repo at branch: ${repo.branch ?? "HEAD"}...`);
    const cloned = await cloneRepo(repo.url, repo.branch ?? "HEAD", owner?.githubToken);
    dir = cloned.dir;
    const commit = commitSha || cloned.head;
    console.log(`[Otto Scan] Cloned successfully. Target commit: ${commit.slice(0, 7)}`);

    // 2. Diff (if lastScannedCommit is equal to HEAD, diff against parent HEAD~1 or full tree)
    let diff = (await getDiff(dir, repo.lastScannedCommit)).slice(0, 80_000);
    if (!diff.trim()) {
      console.log(`[Otto Scan] No diff against previous baseline. Generating diff from latest commit...`);
      const headDiff = await exec("git", ["diff", "--unified=3", "HEAD~1", "HEAD"], { cwd: dir });
      diff = headDiff.code === 0 && headDiff.out.trim() ? headDiff.out.slice(0, 80_000) : (await getDiff(dir, null)).slice(0, 80_000);
    }
    console.log(`[Otto Scan] Commit diff ready (${diff.length} bytes).`);

    // 3. Read source files
    console.log(`[Otto Scan] Reading source files in repo...`);
    const { files } = await readSource(dir);
    console.log(`[Otto Scan] Loaded ${files.length} source file(s) for analysis.`);

    // 4. Pure AI Vulnerability Scan (Gemini)
    console.log(`[Otto Scan] Running Gemini AI security vulnerability scan (${config.model})...`);
    let rawFindings: Finding[] = [];
    if (config.geminiKey) {
      try {
        rawFindings = await scanWithGemini({
          context: repo.context ?? "",
          diff,
          files,
        });
        console.log(`[Otto Scan] Gemini AI identified ${rawFindings.length} vulnerability finding(s):`);
        for (const f of rawFindings) {
          console.log(`  - [${f.ruleId}] ${f.title} (${f.severity}) in ${f.file}:${f.line}`);
        }
      } catch (geminiErr: any) {
        console.error(`[Otto Scan] Gemini analysis error:`, geminiErr.message || geminiErr);
      }
    } else {
      console.warn(`[Otto Scan] Warning: GEMINI_API_KEY is not configured.`);
    }

    // Static port-exposure check flagging backing services bound to all interfaces.
    const exposureFindings = scanExposure(files);
    if (exposureFindings.length) {
      console.log(`[Otto Scan] Port-exposure check flagged ${exposureFindings.length} finding(s):`);
      for (const f of exposureFindings) {
        console.log(`  - [${f.ruleId}] ${f.title} (${f.severity}) in ${f.file}:${f.line}`);
      }
    }
    rawFindings = [...rawFindings, ...exposureFindings];

    // 5. Deduplicate findings
    const allFindings = deduplicateFindings(rawFindings);
    if (allFindings.length !== rawFindings.length) {
      console.log(`[Otto Scan] Total deduplicated findings: ${allFindings.length}`);
    }

    // 6. Compute counts
    const counts = {
      serious: allFindings.filter((f) => f.severity === "serious").length,
      minor: allFindings.filter((f) => f.severity === "minor").length,
      info: allFindings.filter((f) => f.severity === "info").length,
    };
    const status = allFindings.length > 0 ? "fail" : "pass";
    console.log(`[Otto Scan] Final Status: ${status.toUpperCase()} (${counts.serious} serious, ${counts.minor} minor, ${counts.info} info)`);

    // 7. Store scan
    await Scan.create({
      repo: repo._id,
      commit,
      status,
      findings: allFindings,
      counts,
      prNumber,
      ref: ref ?? "",
    });
    console.log(`[Otto Scan] Scan record saved to MongoDB for repo ${repo.name}.`);

    // Update repo's last scanned commit
    repo.lastScannedCommit = commit;
    await repo.save();

    // 9. Post PR comment if applicable
    if (prNumber && allFindings.length > 0) {
      try {
        console.log(`[Otto Scan] Posting PR comment to GitHub PR #${prNumber}...`);
        const owner = await User.findById(repo.owner);
        const ghToken = owner?.githubToken || config.githubAppToken;
        if (ghToken && repo.githubFullName) {
          const [repoOwner, repoName] = repo.githubFullName.split("/");
          const commentBody = formatPRComment(allFindings, commit, counts);
          await postPRComment(ghToken, repoOwner, repoName, prNumber, commentBody);
          console.log(`[Otto Scan] PR comment posted successfully.`);
        }
      } catch (err) {
        console.error("[Otto Scan] Failed to post PR comment:", err);
      }
    }

    console.log(`======================================================\n`);

    return {
      status,
      commit,
      counts,
      findings: allFindings,
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.ruleId || f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatPRComment(findings: Finding[], commit: string, counts: { serious: number; minor: number; info: number }): string {
  const lines: string[] = [];
  lines.push("## 🔒 Otto Security Scan\n");
  lines.push(`**Commit:** \`${commit.slice(0, 7)}\``);
  lines.push(`**Status:** ${counts.serious > 0 ? "🔴" : "⚠️"} ${findings.length} vulnerabilities found\n`);

  const serious = findings.filter((f) => f.severity === "serious");
  const minor = findings.filter((f) => f.severity === "minor");
  const info = findings.filter((f) => f.severity === "info");

  if (serious.length > 0) {
    lines.push(`### 🔴 Serious (${serious.length})`);
    lines.push("| File | Line | Finding | Rule | Source |");
    lines.push("|------|------|---------|------|--------|");
    for (const f of serious) {
      lines.push(`| \`${f.file}\` | ${f.line || "-"} | ${f.title || f.comment.slice(0, 80)} | ${f.ruleId} | ${f.source} |`);
    }
    lines.push("");
  }

  if (minor.length > 0) {
    lines.push(`### ⚠️ Minor (${minor.length})`);
    lines.push("| File | Line | Finding | Rule | Source |");
    lines.push("|------|------|---------|------|--------|");
    for (const f of minor) {
      lines.push(`| \`${f.file}\` | ${f.line || "-"} | ${f.title || f.comment.slice(0, 80)} | ${f.ruleId} | ${f.source} |`);
    }
    lines.push("");
  }

  if (info.length > 0) {
    lines.push(`### ℹ️ Info (${info.length})`);
    lines.push("| File | Line | Finding | Rule |");
    lines.push("|------|------|---------|------|");
    for (const f of info) {
      lines.push(`| \`${f.file}\` | ${f.line || "-"} | ${f.title || f.comment.slice(0, 80)} | ${f.ruleId} |`);
    }
    lines.push("");
  }

  // Suggested fixes
  const withFixes = findings.filter((f) => f.fix);
  if (withFixes.length > 0) {
    lines.push("<details><summary>Suggested Fixes</summary>\n");
    for (const f of withFixes) {
      lines.push(`**${f.file}${f.line ? `:${f.line}` : ""}** (${f.ruleId})`);
      lines.push(`> ${f.fix}\n`);
    }
    lines.push("</details>\n");
  }

  lines.push("---");
  lines.push("*Otto Security · Findings are advisory: review before acting.*");
  return lines.join("\n");
}

app.post("/repos/:id/apply-fix", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const id = oid(req.params.id as string);
  const repo = id && (await Repo.findOne({ _id: id, owner: req.userId }));
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const user = await User.findById(req.userId);
  if (!user?.githubToken) return res.status(400).json({ error: "No GitHub token. Sign in with GitHub first." });
  if (!repo.githubFullName) return res.status(400).json({ error: "Repo is not connected to GitHub" });

  const latestScan = await Scan.findOne({ repo: repo._id }).sort({ createdAt: -1 });
  if (!latestScan || latestScan.findings.length === 0) {
    return res.status(404).json({ error: "No scan findings to fix" });
  }

  // Accept either a single findingIndex or an array of findings indices
  const indices: number[] = Array.isArray(req.body?.findings)
    ? req.body.findings
    : typeof req.body?.findingIndex === "number"
      ? [req.body.findingIndex]
      : [];

  if (indices.length === 0) return res.status(400).json({ error: "findingIndex or findings[] is required" });

  const findings = indices.map((i) => latestScan.findings[i]).filter(Boolean);
  const fixable = findings.filter((f) => f.fix);
  if (fixable.length === 0) return res.status(400).json({ error: "None of the selected findings have a suggested fix" });

  const [repoOwner, repoName] = repo.githubFullName.split("/");
  const pullRequests: { number: number; html_url: string; title: string }[] = [];

  for (const finding of fixable) {
    try {
      const { branch: baseBranch, sha: baseSha } = await getDefaultBranch(user.githubToken, repoOwner, repoName);
      const branchName = `otto-fix/${finding.ruleId}-${Date.now()}`;

      await createBranch(user.githubToken, repoOwner, repoName, branchName, baseSha);

      const currentContent = await getFileContent(user.githubToken, repoOwner, repoName, finding.file, baseBranch);

      const updatedContent = await gemini(
        `Apply this security fix to the file and return ONLY the complete updated file content, no explanation.\n\n` +
        `File: ${finding.file}\n` +
        `Fix to apply: ${finding.fix}\n\n` +
        `Current file content:\n${currentContent}`
      );

      const cleanedContent = stripFences(updatedContent);

      await createOrUpdateFile(
        user.githubToken, repoOwner, repoName,
        finding.file, cleanedContent,
        `fix: ${finding.title}`, branchName,
      );

      const prTitle = `fix: ${finding.title}`;
      const prBody = [
        `## Otto Security Fix`,
        ``,
        `**Finding:** ${finding.title}`,
        `**File:** \`${finding.file}\`${finding.line ? ` (line ${finding.line})` : ""}`,
        `**Severity:** ${finding.severity}`,
        `**Rule:** ${finding.ruleId}`,
        ``,
        `### Description`,
        finding.comment,
        ``,
        `### Suggested Fix`,
        `\`\`\``,
        finding.fix,
        `\`\`\``,
        ``,
        `---`,
        `*Created by Otto Security*`,
      ].join("\n");

      const pr = await createPullRequest(
        user.githubToken, repoOwner, repoName,
        prTitle, prBody, branchName, baseBranch,
      );

      pullRequests.push({ number: pr.number, html_url: pr.html_url, title: prTitle });
    } catch (err: any) {
      console.error(`[Otto] Failed to create fix PR for ${finding.ruleId}:`, err.message || err);
    }
  }

  if (pullRequests.length === 0) {
    return res.status(500).json({ error: "Failed to create any fix PRs" });
  }

  res.json({ pullRequests });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await mongoose.connect(config.mongoUri);
app.listen(config.port, () => console.log(`Otto backend on :${config.port}`));

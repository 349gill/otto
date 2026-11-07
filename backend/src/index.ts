import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { Repo, Scan, User, oid } from "./models.js";
import { gemini } from "./gemini.js";
import { cloneRepo, isValidRepoUrl, readSource } from "./git.js";
import { runPenTest } from "./pentest.js";
import { rm } from "node:fs/promises";

type AuthedRequest = Request & { userId?: string };

const app = express();
app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json({ limit: "100kb" }));

// ---------- rate limiters ----------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
const heavyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20 });

// ---------- auth middleware ----------
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

// ---------- 1. POST /auth ----------
// Login. If ALLOW_SIGNUP=true and the email is new, it creates the account.
app.post("/auth", authLimiter, async (req, res) => {
  const email = String(req.body?.email ?? "").toLowerCase().trim();
  const password = String(req.body?.password ?? "");
  if (!email || password.length < 8) return res.status(400).json({ error: "Email and a password of 8+ characters required" });

  let user = await User.findOne({ email });
  if (!user) {
    if (!config.allowSignup) return res.status(401).json({ error: "Invalid credentials" });
    user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
  } else if (!(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ sub: String(user._id) }, config.jwtSecret, { expiresIn: "7d" });
  res.json({ token, user: { id: user._id, email: user.email } });
});

// ---------- 2. GET /repos (home page) ----------
app.get("/repos", requireAuth, async (req: AuthedRequest, res) => {
  const repos = await Repo.find({ owner: req.userId }).sort({ updatedAt: -1 }).select("-context");
  const items = await Promise.all(
    repos.map(async (r) => {
      const last = await Scan.findOne({ repo: r._id }).sort({ createdAt: -1 }).select("status counts createdAt");
      return {
        id: r._id,
        name: r.name,
        url: r.url,
        lastScan: last ? { status: last.status, counts: last.counts, at: (last as any).createdAt } : null,
      };
    })
  );
  res.json({ repos: items });
});

// ---------- 3. GET /repos/:id (repo detail + 30 day graph) ----------
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
          severe: { $sum: "$counts.severe" },
          minor: { $sum: "$counts.minor" },
          scans: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", severe: 1, minor: 1, scans: 1 } },
    ]),
  ]);

  res.json({
    repo: { id: repo._id, name: repo.name, url: repo.url, branch: repo.branch, lastScannedCommit: repo.lastScannedCommit },
    current: latest
      ? { status: latest.status, counts: latest.counts, findings: latest.findings, scannedAt: (latest as any).createdAt, commit: latest.commit }
      : null,
    history, // [{ date, severe, minor, scans }] for the last 30 days
  });
});

// ---------- 4. POST /setup (ingest code + store context file) ----------
app.post("/setup", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const url = String(req.body?.url ?? "").trim();
  const branch = String(req.body?.branch ?? "HEAD");
  if (!isValidRepoUrl(url)) return res.status(400).json({ error: "url must be a public https GitHub/GitLab/Bitbucket repo URL" });

  let dir = "";
  try {
    const cloned = await cloneRepo(url, branch);
    dir = cloned.dir;
    const { files, tree } = await readSource(dir);

    const sourceDump = files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
    const context = await gemini(`Write a context file (markdown) for a security reviewer who has never seen this project.
Include: what the app does, language/framework, entry points, how to install and start it, the port it listens on,
routes/endpoints, auth model, data stores, external services, and any security-sensitive areas.
Be concrete and concise.

File tree:
${tree.join("\n")}

Source:
${sourceDump}`);

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

// ---------- 5. POST /pen-test ----------
const running = new Set<string>();
app.post("/pen-test", requireAuth, heavyLimiter, async (req: AuthedRequest, res) => {
  const id = oid(String(req.body?.repoId ?? ""));
  const repo = id && (await Repo.findOne({ _id: id, owner: req.userId }));
  if (!repo) return res.status(404).json({ error: "Repo not found. Run /setup first." });
  if (running.has(String(repo._id))) return res.status(409).json({ error: "A pen-test is already running for this repo" });

  running.add(String(repo._id));
  try {
    const result = await runPenTest({
      url: repo.url,
      branch: repo.branch ?? "HEAD",
      context: repo.context ?? "",
      lastScannedCommit: repo.lastScannedCommit ?? null,
    });

    if (!result.skipped) {
      await Scan.create({
        repo: repo._id,
        commit: result.commit,
        status: result.status,
        findings: result.findings,
        counts: {
          severe: result.findings.filter((f) => f.severity === "severe").length,
          minor: result.findings.filter((f) => f.severity === "minor").length,
        },
        script: result.script,
        logs: result.logs,
      });
      if (result.status !== "error") {
        repo.lastScannedCommit = result.commit;
        await repo.save();
      }
    }

    // pass -> all good. fail -> JSON list of line comments + proposed fixes.
    res.json({
      status: result.status,
      commit: result.commit,
      ...(result.status === "fail" ? { findings: result.findings } : {}),
      ...(result.status === "error" ? { error: result.logs } : {}),
      ...(result.skipped ? { message: result.logs } : {}),
    });
  } finally {
    running.delete(String(repo._id));
  }
});

// ---------- error handler (Express 5 forwards async errors here) ----------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await mongoose.connect(config.mongoUri);
app.listen(config.port, () => console.log(`Otto backend on :${config.port}`));
import crypto from "crypto";
import mongoose, { Schema, Types } from "mongoose";

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "default-secret-key-32-bytes-long!!";

function getKey(): Buffer {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

export function encryptToken(text: string): string {
  if (!text) return "";
  const parts = text.split(":");
  if (parts.length === 3 && parts[0].length === 24 && parts[1].length === 32) {
    return text;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptToken(text: string): string {
  if (!text) return "";
  const parts = text.split(":");
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
    return text;
  }
  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text;
  }
}

// ---------- User ----------
const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, default: "" },
    githubId: { type: Number, unique: true, sparse: true },
    githubLogin: { type: String, default: "" },
    githubToken: { type: String, default: "", set: encryptToken, get: decryptToken },
    avatarUrl: { type: String, default: "" },
  },
  { timestamps: true }
);
export const User = mongoose.model("User", userSchema);

// ---------- Repo ----------
// One document per connected repo. `context` is the context file made at /setup
// and reused as background for every scan.
const repoSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    branch: { type: String, default: "HEAD" },
    context: { type: String, default: "" },
    fileCount: { type: Number, default: 0 },
    lastScannedCommit: { type: String, default: null },
    githubFullName: { type: String, default: "" },
    githubId: { type: Number, sparse: true },
    webhookSecret: { type: String, default: "" },
    defaultBranch: { type: String, default: "main" },
  },
  { timestamps: true }
);
repoSchema.index({ owner: 1, url: 1 }, { unique: true });
export const Repo = mongoose.model("Repo", repoSchema);

// ---------- Scan ----------
// One document per scan run. Findings are embedded because they are
// always read together with their scan. counts are stored so the 30-day graph
// is a cheap aggregation instead of unwinding every finding.
const findingSchema = new Schema(
  {
    file: { type: String, required: true },
    line: { type: Number, default: 0 },
    severity: { type: String, enum: ["serious", "minor", "info"], required: true },
    title: { type: String, default: "" },
    comment: { type: String, required: true },
    fix: { type: String, default: "" },
    ruleId: { type: String, default: "" },
    source: { type: String, enum: ["deterministic", "ai"], default: "deterministic" },
  },
  { _id: false }
);

const scanSchema = new Schema(
  {
    repo: { type: Schema.Types.ObjectId, ref: "Repo", required: true },
    commit: { type: String, required: true },
    status: { type: String, enum: ["pass", "fail", "error"], required: true },
    findings: { type: [findingSchema], default: [] },
    counts: {
      serious: { type: Number, default: 0 },
      minor: { type: Number, default: 0 },
      info: { type: Number, default: 0 },
    },
    prNumber: { type: Number, default: null },
    ref: { type: String, default: "" },
    script: { type: String, default: "" },
    logs: { type: String, default: "" },
  },
  { timestamps: true }
);
scanSchema.index({ repo: 1, createdAt: -1 });
export const Scan = mongoose.model("Scan", scanSchema);

export type RepoDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof repoSchema>>;
export type Finding = {
  file: string;
  line: number;
  severity: "serious" | "minor" | "info";
  title: string;
  comment: string;
  fix: string;
  ruleId: string;
  source: "deterministic" | "ai";
};
export const oid = (s: string) => (Types.ObjectId.isValid(s) ? new Types.ObjectId(s) : null);
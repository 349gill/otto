import mongoose, { Schema, Types } from "mongoose";

// ---------- User ----------
const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, default: "" },
    githubId: { type: Number, unique: true, sparse: true },
    githubLogin: { type: String, default: "" },
    githubToken: { type: String, default: "" },
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

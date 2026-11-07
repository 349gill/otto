import mongoose, { Schema, Types } from "mongoose";

// ---------- User ----------
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);
export const User = mongoose.model("User", userSchema);

// ---------- Repo ----------
// One document per connected repo. `context` is the context file made at /setup
// and reused as background for every pen-test run.
const repoSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    branch: { type: String, default: "HEAD" },
    context: { type: String, default: "" },
    fileCount: { type: Number, default: 0 },
    lastScannedCommit: { type: String, default: null },
  },
  { timestamps: true }
);
repoSchema.index({ owner: 1, url: 1 }, { unique: true });
export const Repo = mongoose.model("Repo", repoSchema);

// ---------- Scan ----------
// One document per /pen-test run. Findings are embedded because they are
// always read together with their scan. counts are stored so the 30-day graph
// is a cheap aggregation instead of unwinding every finding.
const findingSchema = new Schema(
  {
    file: { type: String, required: true },
    line: { type: Number, default: 0 },
    severity: { type: String, enum: ["severe", "minor"], required: true },
    comment: { type: String, required: true },
    fix: { type: String, default: "" },
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
      severe: { type: Number, default: 0 },
      minor: { type: Number, default: 0 },
    },
    script: { type: String, default: "" }, // the Gemini pen-test script that ran
    logs: { type: String, default: "" }, // script output (or error details)
  },
  { timestamps: true }
);
scanSchema.index({ repo: 1, createdAt: -1 });
export const Scan = mongoose.model("Scan", scanSchema);

export type RepoDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof repoSchema>>;
export type Finding = {
  file: string;
  line: number;
  severity: "severe" | "minor";
  comment: string;
  fix: string;
};
export const oid = (s: string) => (Types.ObjectId.isValid(s) ? new Types.ObjectId(s) : null);
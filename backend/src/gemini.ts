import { config } from "./config.js";
import type { Finding } from "./models.js";

// Strip obvious secrets before anything is sent to Google.
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(
      /((?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["'])(?:[a-zA-Z0-9_\-./+]{16,}|[^\s"',;]{20,})(["'])/gi,
      "$1[REDACTED_SECRET]$2"
    );
}

function geminiAvailable(): boolean {
  return config.geminiKey.length > 0;
}

const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];

/**
 * Call Gemini API with automatic model fallback and timeout protection.
 */
export async function gemini(prompt: string, asJson = false): Promise<string> {
  if (!geminiAvailable()) throw new Error("Gemini API key not configured");

  const modelsToTry = [...new Set([config.model, ...FALLBACK_MODELS].filter(Boolean))];
  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: redact(prompt) }] }],
          generationConfig: asJson ? { responseMimeType: "application/json" } : undefined,
        }),
        signal: AbortSignal.timeout(45_000), // 45-second timeout avoids undici HTTP/2 hangs
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini (${model}) ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data: any = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (!text) throw new Error(`Gemini (${model}) returned an empty response`);

      return text;
    } catch (err: any) {
      console.warn(`[Otto AI] Model ${model} attempt failed: ${err.message || err}. Trying next fallback if available...`);
      lastError = err;
    }
  }

  throw lastError ?? new Error("All Gemini model attempts failed");
}

/**
 * Robust JSON parser with fallback retries.
 */
export async function geminiJson<T>(prompt: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await gemini(prompt, true);
    try {
      const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      return JSON.parse(cleaned) as T;
    } catch {
      /* retry once */
    }
  }
  throw new Error("Gemini did not return valid JSON");
}

export function stripFences(text: string): string {
  return text.replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

// ---------------------------------------------------------------------------
// High-Sensitivity AI Vulnerability Scanner
// ---------------------------------------------------------------------------

/**
 * High-sensitivity AI vulnerability scanner:
 * Passes repository code files, diff, and architecture context to Gemini to perform
 * an exhaustive security audit covering direct exploits, defense-in-depth gaps, and misconfigurations.
 */
export async function scanWithGemini(opts: {
  context: string;
  diff: string;
  files: { path: string; content: string }[];
}): Promise<Finding[]> {
  if (!geminiAvailable()) {
    console.warn("[Otto AI] Gemini API key not provided; skipping scan.");
    return [];
  }

  const MAX_DIFF = 60_000;
  const diffSnippet = opts.diff.slice(0, MAX_DIFF);

  // Ingest up to 120,000 characters prioritizing high-risk areas
  let codeContext = "";
  if (opts.files && opts.files.length > 0) {
    const importantExtensions = [".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rb", ".php", ".env", ".json", ".yml", ".yaml"];

    function securityScore(filePath: string): number {
      const lower = filePath.toLowerCase();
      let score = 0;
      if (/auth|jwt|token|login|session|password|credential/i.test(lower)) score += 50;
      if (/route|api|controller|endpoint|handler|server|app/i.test(lower)) score += 40;
      if (/db|sql|database|model|schema|query|prisma/i.test(lower)) score += 35;
      if (/middleware|security|cors|csrf|sanitiz|guard/i.test(lower)) score += 30;
      if (/\.env|config|docker|package\.json/i.test(lower)) score += 25;
      if (/util|helper|service/i.test(lower)) score += 10;
      if (/test|mock|spec|fixture|dist|build|\.next/i.test(lower)) score -= 100;
      return score;
    }

    const sortedFiles = [...opts.files]
      .filter((f) => importantExtensions.some((ext) => f.path.endsWith(ext)))
      .sort((a, b) => securityScore(b.path) - securityScore(a.path))
      .slice(0, 35);

    let budget = 120_000;
    const dumped: string[] = [];
    for (const f of sortedFiles) {
      if (budget <= 0) break;
      const snippet = f.content.slice(0, Math.min(budget, 10_000));
      budget -= snippet.length;
      dumped.push(`--- File: ${f.path} ---\n${snippet}`);
    }
    codeContext = dumped.join("\n\n");
  }

  const prompt = `You are an automated code quality and defensive security review engine.
Conduct a thorough, high-sensitivity static analysis code review of the following source files and diff to identify all security weaknesses, vulnerabilities, insecure configurations, and missing defenses.

Repository Context:
${opts.context || "Application codebase"}

${diffSnippet ? `Recent Changes / Diff:\n${diffSnippet}\n` : ""}

${codeContext ? `Source Files:\n${codeContext}\n` : ""}

Vigilantly review for both critical vulnerabilities and defense-in-depth security risks:
1. Input handling and validation: SQL Injection, Command Injection / RCE, Template Injection, NoSQL injection, unvalidated parameters.
2. Hardcoded Credentials & Secrets: API keys, tokens, private keys, database credentials, JWT secrets.
3. Authentication & Sessions: Missing auth checks, CSRF, unvalidated redirect parameters, weak JWT handling/algorithms, insecure password hashing.
4. Access Control & Authorization: Missing user ownership checks (IDOR/BOLA), privilege escalation risks.
5. Path Handling & File Operations: Unvalidated file paths, path traversal risks, arbitrary read/write.
6. Server-Side Request Forgery (SSRF) & Insecure Outbound Calls.
7. Denial of Service & Resource Exhaustion: Missing rate limiters on sensitive/auth routes, unbounded memory or regex patterns.
8. Transport & Security Headers: Permissive CORS, missing security headers (Helmet, CSP), insecure cookie flags (missing httpOnly, secure, sameSite).
9. Sensitive Information Exposure: Leaking stack traces, raw DB errors, unredacted credentials, or debug payloads.
10. Insecure Cryptography & Randomness: Math.random() for security tokens, weak hashing (MD5/SHA1), hardcoded encryption keys.

Categorize each issue:
- "serious": High risk vulnerabilities that could lead to unauthorized access, data compromise, authentication bypass, or code execution.
- "minor": Hardening opportunities, missing defense-in-depth controls, input validation gaps, missing rate limiters, or configuration weaknesses.

Return a JSON array of objects. Each object must have:
{
  "file": "<relative file path>",
  "line": <line number integer, or 1 if general file issue>,
  "severity": "serious" or "minor",
  "title": "<short descriptive title of the issue>",
  "comment": "<clear technical explanation of the issue, risk, and why remediation is needed>",
  "fix": "<proposed secure code patch or fix>"
}

Sensitivity Instruction:
Be proactive, rigorous, and thorough. Report all genuine security risks, defense gaps, and weaknesses you identify across the files and diff.
Provide actionable code fixes for every issue reported.`;

  try {
    const raw = await geminiJson<unknown>(prompt);
    console.log("[Otto AI] Raw findings received from Gemini:", Array.isArray(raw) ? `${raw.length} items` : typeof raw);
    return cleanAiFindings(raw);
  } catch (err: any) {
    console.error("[Otto AI] Gemini vulnerability scan failed:", err.message || err);
    return [];
  }
}

function cleanAiFindings(raw: unknown, max = 50): Finding[] {
  if (!Array.isArray(raw)) return [];
  let counter = 1;
  return raw.slice(0, max).flatMap((f: any) =>
    f && typeof f.file === "string" && (typeof f.comment === "string" || typeof f.title === "string")
      ? [
          {
            file: f.file.slice(0, 300),
            line: Number.isInteger(f.line) && f.line > 0 ? f.line : 1,
            severity: f.severity === "serious" ? ("serious" as const) : ("minor" as const),
            title: (typeof f.title === "string" ? f.title : "Security Vulnerability").slice(0, 200),
            comment: (typeof f.comment === "string" ? f.comment : f.title ?? "").slice(0, 3000),
            fix: typeof f.fix === "string" ? f.fix.slice(0, 4000) : "",
            ruleId: `SEC-AI-${String(counter++).padStart(3, "0")}`,
            source: "ai" as const,
          },
        ]
      : []
  );
}

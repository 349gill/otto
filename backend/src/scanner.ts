import type { Finding } from "./models.js";

// ---------------------------------------------------------------------------
// Rule type
// ---------------------------------------------------------------------------

type ScanRule = {
  id: string;
  severity: "serious" | "minor" | "info";
  title: string;
  /** Returns matches found in the file content. */
  detect: (content: string, filePath: string) => { line: number; evidence: string }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check each line of `content` against a regex. */
function matchLines(
  content: string,
  pattern: RegExp,
  filter?: (line: string, index: number, lines: string[]) => boolean,
): { line: number; evidence: string }[] {
  const lines = content.split("\n");
  const results: { line: number; evidence: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pattern.test(line)) {
      // Skip comments (simple heuristic: trimmed line starts with // or # or *)
      const trimmed = line.trimStart();
      if (/^(\/\/|#|\*|\/\*)/.test(trimmed)) continue;
      if (filter && !filter(line, i, lines)) continue;
      results.push({ line: i + 1, evidence: line.trim().slice(0, 200) });
    }
  }
  return results;
}

/** True if the file looks like a test / spec / fixture. */
function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    /\.(test|spec)\.[jt]sx?$/.test(lower) ||
    /__(tests?|mocks?|fixtures?)__/.test(lower) ||
    /\/test\//.test(lower) ||
    /\/tests\//.test(lower) ||
    /\.stories\.[jt]sx?$/.test(lower) ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".spec.js")
  );
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const rules: ScanRule[] = [
  // ---- SERIOUS ----
  {
    id: "SEC-001",
    severity: "serious",
    title: "SQL Injection",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:\.query\s*\(\s*['"`].*\$\{|\.query\s*\(\s*['"`].*\+\s|\.query\s*\(\s*[^'"`)\s]|\.execute\s*\(\s*['"`].*\$\{|\.execute\s*\(\s*['"`].*\+\s|raw\s*\(\s*['"`].*\$\{)/,
      );
    },
  },
  {
    id: "SEC-002",
    severity: "serious",
    title: "Command Injection",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:\bexec\s*\(\s*[`'"].*\$\{|\bexec\s*\(\s*[^)]*\+|\bexecSync\s*\(\s*[`'"].*\$\{|\bexecSync\s*\(\s*[^)]*\+|\beval\s*\(\s*[^)]*(?:req\b|input|user|param|query|body)|\bFunction\s*\(\s*[^)]*(?:req\b|input|user|param|query|body)|child_process.*\bexec\s*\()/,
      );
    },
  },
  {
    id: "SEC-003",
    severity: "serious",
    title: "Hardcoded Secrets",
    detect(content, filePath) {
      if (isTestFile(filePath)) return [];
      // Also skip .example / .sample / .template env files
      if (/\.(example|sample|template)$/i.test(filePath)) return [];

      const patterns = [
        // AWS access key IDs
        /\bAKIA[0-9A-Z]{16}\b/,
        // Private keys
        /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
        // Assignments of secrets with actual values (not empty / placeholder)
        /(?:password|passwd|api_key|apikey|api_secret|secret_key|access_token|auth_token|private_key)\s*[:=]\s*["'][^"']{8,}["']/i,
        // Generic token assignments with substantial values
        /(?:secret|token)\s*[:=]\s*["'][A-Za-z0-9+/=_\-]{20,}["']/i,
      ];

      const results: { line: number; evidence: string }[] = [];
      for (const pat of patterns) {
        results.push(...matchLines(content, pat));
      }
      return results;
    },
  },
  {
    id: "SEC-004",
    severity: "serious",
    title: "Path Traversal",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:fs\.\w+\s*\(\s*(?:req\.|request\.)|path\.join\s*\(\s*[^)]*(?:req\.|request\.)|\.\.\/)/,
        (line) => {
          // Only flag ../ if it appears in a file-system operation context
          if (/\.\.\//.test(line) && !/(?:import|require|from)\s/.test(line)) {
            return /(?:fs\.|readFile|writeFile|readdir|createReadStream|path\.)/.test(line);
          }
          return true;
        },
      );
    },
  },
  {
    id: "SEC-005",
    severity: "serious",
    title: "Insecure Deserialization",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:JSON\.parse\s*\(\s*(?:req\.|request\.|body|input|user|param|query)|\bunserialize\s*\(\s*(?:req\.|request\.|body|input|user|param|query)|\beval\s*\(\s*(?:req\.|request\.|body|input|user|param|query))/,
      );
    },
  },

  // ---- MINOR ----
  {
    id: "SEC-006",
    severity: "minor",
    title: "XSS Potential",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|v-html\s*=)/,
      );
    },
  },
  {
    id: "SEC-007",
    severity: "minor",
    title: "Insecure Crypto",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:createHash\s*\(\s*['"](?:md5|sha1)['"].*password|createHash\s*\(\s*['"]md5['"]|Math\.random\s*\(\s*\).*(?:secret|token|key|password|salt|nonce|iv|csrf)|crypto\.createCipher\s*\()/i,
      );
    },
  },
  {
    id: "SEC-008",
    severity: "minor",
    title: "Missing Security Headers",
    detect(content, filePath) {
      // Only check entry-point-looking files
      if (!/(?:index|app|server|main)\.[jt]sx?$/.test(filePath)) return [];
      // Look for express app creation without helmet
      if (/express\s*\(/.test(content) && !/helmet/.test(content)) {
        return [{ line: 1, evidence: "Express app created without helmet middleware" }];
      }
      return [];
    },
  },
  {
    id: "SEC-009",
    severity: "minor",
    title: "Insecure HTTP",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:fetch\s*\(\s*['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)|axios\s*[\w.]*\(\s*['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)|request\s*\(\s*['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)|\.get\s*\(\s*['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0))/,
      );
    },
  },
  {
    id: "SEC-010",
    severity: "minor",
    title: "Open Redirect",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:res\.redirect\s*\(\s*(?:req\.(?:query|params|body)|request\.)|\.redirect\s*\(\s*(?:req\.(?:query|params|body)))/,
      );
    },
  },
  {
    id: "SEC-011",
    severity: "minor",
    title: "SSRF",
    detect(content, _fp) {
      return matchLines(
        content,
        /(?:fetch\s*\(\s*(?:req\.|request\.|user|input|param|query|body)|axios\s*[\w.]*\(\s*(?:req\.|request\.|user|input|param|query|body)|request\s*\(\s*(?:req\.|request\.|user|input|param|query|body)|http\.get\s*\(\s*(?:req\.|request\.|user|input|param|query|body))/,
      );
    },
  },
  {
    id: "SEC-012",
    severity: "minor",
    title: "Weak Authentication",
    detect(content, filePath) {
      const results: { line: number; evidence: string }[] = [];
      // Session cookie without httpOnly or secure
      results.push(
        ...matchLines(
          content,
          /(?:cookie\s*[:=]\s*\{[^}]*(?!httpOnly)[^}]*\}|session\s*\(\s*\{[^}]*(?:httpOnly\s*:\s*false|secure\s*:\s*false))/,
        ),
      );
      return results;
    },
  },
  {
    id: "SEC-013",
    severity: "minor",
    title: "Information Disclosure",
    detect(content, filePath) {
      if (isTestFile(filePath)) return [];
      const results: { line: number; evidence: string }[] = [];
      // console.log with sensitive-looking variable names
      results.push(
        ...matchLines(
          content,
          /console\.log\s*\([^)]*(?:password|secret|token|apiKey|api_key|credential|privateKey)/i,
        ),
      );
      // Error stack sent to client
      results.push(
        ...matchLines(
          content,
          /(?:res\.(?:json|send)\s*\([^)]*(?:err\.stack|error\.stack)|\.stack\s*\))/,
        ),
      );
      // DEBUG=true in source
      results.push(
        ...matchLines(content, /\bDEBUG\s*[:=]\s*(?:true|['"]true['"]|1)\b/),
      );
      return results;
    },
  },
  {
    id: "SEC-014",
    severity: "minor",
    title: "Insecure Dependencies",
    detect(content, filePath) {
      if (!filePath.endsWith("package.json")) return [];
      const results: { line: number; evidence: string }[] = [];
      // Known-problematic patterns in package.json
      const knownVulnerable = [
        /["']event-stream["']\s*:\s*["'].*3\.3\.6/,
        /["']ua-parser-js["']\s*:\s*["'].*0\.7\.29/,
        /["']lodash["']\s*:\s*["']\^?[234]\.\d/,
      ];
      for (const pat of knownVulnerable) {
        results.push(...matchLines(content, pat));
      }
      return results;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the deterministic vulnerability scanner against a set of source files.
 * Returns an array of Finding objects.
 */
export function scanCode(files: { path: string; content: string }[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    for (const rule of rules) {
      const matches = rule.detect(file.content, file.path);
      for (const m of matches) {
        const dedupeKey = `${file.path}:${m.line}:${rule.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        findings.push({
          file: file.path,
          line: m.line,
          severity: rule.severity,
          title: rule.title,
          comment: `${rule.title}: ${m.evidence}`,
          fix: getFix(rule.id),
          ruleId: rule.id,
          source: "deterministic",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Fix suggestions per rule
// ---------------------------------------------------------------------------

function getFix(ruleId: string): string {
  const fixes: Record<string, string> = {
    "SEC-001": "Use parameterized queries or an ORM instead of string concatenation in SQL statements.",
    "SEC-002": "Use execFile() with an argument array instead of exec() with string interpolation. Never pass user input to eval() or Function().",
    "SEC-003": "Move secrets to environment variables and load them via process.env. Never commit credentials to source control.",
    "SEC-004": "Validate and sanitize file paths. Use path.resolve() and verify the resolved path stays within the intended base directory.",
    "SEC-005": "Validate and schema-check parsed input (e.g., with zod or joi) before using it. Never eval() user-supplied data.",
    "SEC-006": "Sanitize HTML before inserting into the DOM. Use a library like DOMPurify or textContent instead of innerHTML.",
    "SEC-007": "Use bcrypt, scrypt, or argon2 for password hashing. Use crypto.randomBytes() instead of Math.random() for security-sensitive values.",
    "SEC-008": "Add helmet middleware: app.use(helmet()). This sets various security-related HTTP headers.",
    "SEC-009": "Use HTTPS for all external requests. Update URLs from http:// to https://.",
    "SEC-010": "Validate redirect URLs against an allow-list of trusted domains before redirecting.",
    "SEC-011": "Validate and restrict URLs to an allow-list before making server-side requests. Block internal/private IP ranges.",
    "SEC-012": "Set httpOnly: true and secure: true on session cookies. Add rate limiting to authentication endpoints.",
    "SEC-013": "Remove console.log statements that output sensitive data. Use a structured logger with redaction. Never expose stack traces to end users.",
    "SEC-014": "Run `npm audit` and update vulnerable dependencies to patched versions.",
  };
  return fixes[ruleId] ?? "";
}

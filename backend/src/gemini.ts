import { config } from "./config.js";

// Strip obvious secrets before anything is sent to Google.
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(
      /((?:password|passwd|secret|token|api[_-]?key|private[_-]?key|community)\s*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
      "$1[REDACTED]"
    );
}

export async function gemini(prompt: string, asJson = false): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: redact(prompt) }] }],
        generationConfig: asJson ? { responseMimeType: "application/json" } : undefined,
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

// Gemini sometimes still returns bad JSON, so never trust it blindly.
export async function geminiJson<T>(prompt: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await gemini(prompt, true);
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
    } catch {
      /* retry once */
    }
  }
  throw new Error("Gemini did not return valid JSON");
}

export function stripFences(text: string): string {
  return text.replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}
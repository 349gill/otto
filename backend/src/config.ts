function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: need("MONGODB_URI"),
  jwtSecret: need("JWT_SECRET"),
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  allowSignup: process.env.ALLOW_SIGNUP === "true",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  backendUrl: process.env.BACKEND_URL ?? `http://localhost:${Number(process.env.PORT ?? 4000)}`,
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubAppToken: process.env.GITHUB_APP_TOKEN ?? "",
};

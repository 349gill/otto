function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: need("MONGODB_URI"),
  jwtSecret: need("JWT_SECRET"),
  geminiKey: need("GEMINI_API_KEY"),
  model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  allowSignup: process.env.ALLOW_SIGNUP === "true",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
};
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env.local by itself. Variables already set in the shell win,
// so `DATABASE_URL=<supabase url> pnpm db:migrate` targets Supabase instead of local Docker.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (for example in CI): rely on the real environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});

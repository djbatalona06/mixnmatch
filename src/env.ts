// Everything the server can reach: the database plus settings and secrets from
// environment variables (set in the Vercel dashboard, or in .env.local for local runs).
import { getDb, type Db } from "./db";

export interface Env {
  DB: Db;

  // Secrets
  TOKEN_KEY: string; // base64 of 32 random bytes, used to encrypt music-service tokens
  CRON_SECRET?: string; // Vercel sends this with every cron call; nobody else may run the cron
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  RESEND_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  TIDAL_CLIENT_ID?: string;
  TIDAL_CLIENT_SECRET?: string;
  DEEZER_APP_ID?: string;
  DEEZER_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SOUNDCLOUD_CLIENT_ID?: string;
  SOUNDCLOUD_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string; // Stripe price id, e.g. price_123
  STRIPE_PRICE_YEARLY?: string;

  // Plain settings
  EMAIL_FROM?: string;
  DEV_MODE?: string; // "1" = show the sign-in link on screen instead of emailing it
  ENABLE_MOCK?: string; // "1" = add a pretend music service for testing
}

/** Reads the settings from the environment. Called once per request by the API function. */
export function loadEnv(): Env {
  return { ...process.env, DB: getDb() } as Env;
}

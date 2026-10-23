// Everything the Worker can reach: bindings from wrangler.jsonc plus secrets.
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TRANSFER_JOB: DurableObjectNamespace;

  // Secrets (set with `npx wrangler secret put NAME`, or in .dev.vars locally)
  TOKEN_KEY: string; // base64 of 32 random bytes, used to encrypt music-service tokens
  RESEND_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  TIDAL_CLIENT_ID?: string;
  TIDAL_CLIENT_SECRET?: string;
  DEEZER_APP_ID?: string;
  DEEZER_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // Plain settings
  EMAIL_FROM?: string;
  DEV_MODE?: string; // "1" = show the sign-in link on screen instead of emailing it
  ENABLE_MOCK?: string; // "1" = add a pretend music service for testing
}

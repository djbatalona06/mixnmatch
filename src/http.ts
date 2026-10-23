// Calling music-service APIs safely: retries, rate limits and clear errors.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** The service said "slow down". The job should pause and try again later. */
export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Rate limited, retry in ${retryAfterSec}s`);
  }
}

/** Our daily allowance for this service is used up (YouTube). */
export class QuotaError extends Error {
  constructor(public platform: string) {
    super(`Daily ${platform} quota used up`);
  }
}

/** The access token is no longer valid. */
export class AuthError extends Error {}

/** Any other API failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Short waits happen inside the request; longer ones pause the whole job.
const MAX_INLINE_WAIT_SEC = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseRetryAfter(value: string | null, fallbackSec = 5): number {
  if (!value) return fallbackSec;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  return fallbackSec;
}

/**
 * fetch() + JSON with exponential backoff.
 * 429 -> wait (if short) or throw RateLimitError. 401 -> AuthError. 5xx -> retry.
 */
export async function requestJson<T = any>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit = {},
  attempts = 3,
): Promise<T> {
  let lastError: Error = new ApiError("Request failed", 0);
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, init);
    } catch (err) {
      lastError = err as Error;
      await sleep(250 * 2 ** attempt);
      continue;
    }

    if (res.status === 429) {
      const wait = parseRetryAfter(res.headers.get("Retry-After"), 2 ** (attempt + 1));
      if (wait > MAX_INLINE_WAIT_SEC || attempt === attempts - 1) throw new RateLimitError(wait);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401) throw new AuthError(`Unauthorized: ${url.split("?")[0]}`);
    if (res.status >= 500) {
      lastError = new ApiError(`Server error ${res.status}`, res.status);
      await sleep(250 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  throw lastError;
}

export function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

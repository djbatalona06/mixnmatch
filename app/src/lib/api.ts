// Talks to the mix n match server. Every screen uses this instead of calling fetch() directly.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface Page<T> {
  items: T[];
  next?: string;
}

/**
 * api("/api/me")                         -> GET
 * api("/api/jobs", { method: "POST", body: {...} })
 */
export async function api<T = any>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        // The server rejects changes that do not carry this header (protects against other sites).
        "X-Requested-With": "mixnmatch",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(navigator.onLine ? "Can't reach mix n match right now. Please try again." : "You're offline. Connect to the internet and try again.", 0);
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // empty or non-JSON reply
  }

  if (response.status === 401 && !location.pathname.startsWith("/login")) {
    location.href = "/login";
    throw new ApiError("Please sign in", 401);
  }
  if (!response.ok) throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
  return data as T;
}

/** Fetches every page of a list (playlists or songs), calling onProgress as it goes. */
export async function fetchAllPages<T>(path: string, onProgress: (n: number) => void = () => {}, maxItems = 10000): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const url = cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
    const page = await api<Page<T>>(url);
    items.push(...page.items);
    onProgress(items.length);
    cursor = page.next;
  } while (cursor && items.length < maxItems);
  return items;
}

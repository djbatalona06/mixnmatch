// Talks to the mix n match server. Every page uses this instead of calling fetch() directly.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * api("/api/me")                         -> GET
 * api("/api/jobs", { method: "POST", body: {...} })
 */
export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      // The server rejects changes that do not carry this header (protects against other sites).
      "X-Requested-With": "mixnmatch",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
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
  return data;
}

/** Fetches every page of a list (playlists or songs), calling onProgress as it goes. */
export async function fetchAllPages(path, onProgress = () => {}, maxItems = 10000) {
  const items = [];
  let cursor;
  do {
    const url = cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
    const page = await api(url);
    items.push(...page.items);
    onProgress(items.length);
    cursor = page.next;
  } while (cursor && items.length < maxItems);
  return items;
}

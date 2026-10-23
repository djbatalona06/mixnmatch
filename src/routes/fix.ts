// Fix-it screen (FR-07): search the destination by hand for a song we were unsure about,
// then add the right one, or skip it.
//
// Safety: manual picks are never saved into the shared match_cache, so one person
// can't teach a wrong match to everyone else.
import { getAdapter } from "../adapters/registry";
import type { User } from "../auth/session";
import { withToken } from "../connections";
import type { Env } from "../env";
import { ApiError, QuotaError } from "../http";
import { audit, HttpError, json } from "../web";
import { str } from "./jobs";

const FIXABLE = ["LOW_CONFIDENCE", "FAILED", "SKIPPED"];
const FINISHED = ["DONE", "FAILED", "CANCELLED"];
export const SEARCHES_PER_MINUTE = 30;

interface ItemRow {
  id: number;
  sel_index: number;
  src_title: string;
  src_artist: string;
  status: string;
  written: number;
  dest_id: string | null;
  dest_title: string | null;
  dest_artist: string | null;
  confidence: number | null;
  method: string | null;
  dest: string;
  job_status: string;
  kind: string;
  dest_playlist_id: string | null;
  write_done: number;
}

/** Loads one song of one of the user's transfers. Anything else is "not found" (never "forbidden"). */
async function ownedItem(env: Env, user: User, jobId: string, itemId: number): Promise<ItemRow> {
  const row = await env.DB.prepare(
    `SELECT i.id, i.sel_index, i.src_title, i.src_artist, i.status, i.written,
            i.dest_id, i.dest_title, i.dest_artist, i.confidence, i.method,
            j.dest, j.status AS job_status, s.kind, s.dest_playlist_id, s.write_done
     FROM transfer_items AS i
     JOIN transfer_jobs AS j ON j.id = i.job_id
     LEFT JOIN transfer_selections AS s ON s.job_id = i.job_id AND s.sel_index = i.sel_index
     WHERE i.id = ?1 AND i.job_id = ?2 AND j.user_id = ?3`,
  )
    .bind(itemId, jobId, user.id)
    .first<ItemRow>();
  if (!row) throw new HttpError(404, "Song not found");
  return row;
}

function requireFixable(item: ItemRow) {
  if (!FIXABLE.includes(item.status) || item.written !== 0) throw new HttpError(409, "This song doesn't need fixing");
}

export async function searchForItem(env: Env, user: User, jobId: string, itemId: number, url: URL): Promise<Response> {
  const item = await ownedItem(env, user, jobId, itemId);
  requireFixable(item);

  const since = Date.now() - 60_000;
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND action = 'fix_search' AND at > ?2")
    .bind(user.id, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= SEARCHES_PER_MINUTE) throw new HttpError(429, "That's a lot of searches. Please wait a minute.");
  await audit(env, user.id, "fix_search", null, null);

  const q = str(url.searchParams.get("q"), 200);
  const adapter = getAdapter(env, item.dest as any);
  try {
    const found = await withToken(env, user.id, adapter, (token) =>
      adapter.search(token, q ? { title: q, artist: "" } : { title: item.src_title, artist: item.src_artist }),
    );
    return json({
      results: found.slice(0, 10).map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album ?? null })),
    });
  } catch (err) {
    if (err instanceof QuotaError) throw new HttpError(429, "YouTube's daily allowance is used up. Try again after midnight (UTC).");
    throw err;
  }
}

export async function skipItem(env: Env, user: User, jobId: string, itemId: number): Promise<Response> {
  const item = await ownedItem(env, user, jobId, itemId);
  requireFixable(item);
  await env.DB.prepare("UPDATE transfer_items SET status = 'SKIPPED' WHERE id = ?1 AND written = 0").bind(item.id).run();
  return json({ ok: true, status: "SKIPPED" });
}

export async function fixItem(
  env: Env,
  user: User,
  jobId: string,
  itemId: number,
  body: { destId?: string; destTitle?: string; destArtist?: string },
): Promise<Response> {
  const destId = str(body?.destId, 200);
  if (!destId || /[\u0000-\u001f]/.test(destId)) throw new HttpError(400, "Pick a song first");
  const destTitle = str(body?.destTitle, 300) || null;
  const destArtist = str(body?.destArtist, 300) || null;

  const item = await ownedItem(env, user, jobId, itemId);
  requireFixable(item);
  // Transfers from before v1.1 don't record where songs went, so we can't add to them safely.
  if (!item.kind) throw new HttpError(409, "This transfer is too old to fix here. Download the list of songs to check instead.");

  // Claim the row first: a second click (or a second tab) now fails the status check above.
  const claimed = await env.DB.prepare(
    `UPDATE transfer_items SET status = 'MATCHED', method = 'manual', confidence = 1,
       dest_id = ?2, dest_title = ?3, dest_artist = ?4
     WHERE id = ?1 AND written = 0 AND status = ?5 RETURNING id`,
  )
    .bind(item.id, destId, destTitle, destArtist, item.status)
    .first();
  if (!claimed) throw new HttpError(409, "This song was just changed. Please reload the page.");

  // Already in the list (added earlier, or there before)? Then don't add it again.
  const duplicate = await env.DB.prepare(
    `SELECT 1 FROM transfer_items WHERE job_id = ?1 AND sel_index = ?2 AND id != ?3
       AND dest_id = ?4 AND status = 'MATCHED' AND written != 0`,
  )
    .bind(jobId, item.sel_index, item.id, destId)
    .first();
  if (duplicate && item.kind === "playlist") {
    await env.DB.prepare("UPDATE transfer_items SET written = 2 WHERE id = ?1").bind(item.id).run();
    return json({ ok: true, status: "MATCHED", written: 2 });
  }

  // A running job adds it itself, unless it has already finished this playlist.
  const jobWillAddIt = !FINISHED.includes(item.job_status) && !item.write_done;
  if (jobWillAddIt) return json({ ok: true, status: "MATCHED", written: 0 });

  const isPlaylist = item.kind === "playlist";
  if (isPlaylist && !item.dest_playlist_id) {
    // The job stopped before it made the playlist; "Try again" will add this song.
    return json({ ok: true, status: "MATCHED", written: 0, note: "It will be added when you press Try again." });
  }

  const adapter = getAdapter(env, item.dest as any);
  try {
    await withToken(env, user.id, adapter, (token) =>
      isPlaylist ? adapter.addTracksToPlaylist(token, item.dest_playlist_id!, [destId]) : adapter.saveTracks(token, [destId]),
    );
  } catch (err) {
    // Put the song back the way it was, so the Fix button shows again.
    await env.DB.prepare(
      `UPDATE transfer_items SET status = ?2, dest_id = ?3, dest_title = ?4, dest_artist = ?5, confidence = ?6, method = ?7
       WHERE id = ?1`,
    )
      .bind(item.id, item.status, item.dest_id, item.dest_title, item.dest_artist, item.confidence, item.method)
      .run();
    if (err instanceof ApiError && err.status === 404) throw new HttpError(409, "That playlist no longer exists on the destination app.");
    if (err instanceof QuotaError) throw new HttpError(429, "YouTube's daily allowance is used up. Try again after midnight (UTC).");
    throw err;
  }
  await env.DB.prepare("UPDATE transfer_items SET written = 1 WHERE id = ?1").bind(item.id).run();
  return json({ ok: true, status: "MATCHED", written: 1 });
}

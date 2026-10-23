// Live progress for one transfer, the per-song results table, and the actions on it:
// Stop, Try again, Fix a song by hand, and Keep in sync.
import { api } from "./api.js";
import { toCsv } from "./formats.js";
import { $, downloadFile, el, loadUser, platformName, plural, toast } from "./ui.js";

const jobId = new URLSearchParams(location.search).get("job");
const POLL_MS = 2000;
const FIXABLE = ["LOW_CONFIDENCE", "FAILED", "SKIPPED"];

const RESULT_LABEL = {
  PENDING: ["", "Waiting"],
  MATCHED: ["ok", "Matched"],
  LOW_CONFIDENCE: ["warn", "Need a look"],
  FAILED: ["bad", "Not found"],
  SKIPPED: ["", "Skipped"],
};
const METHOD_LABEL = {
  isrc: "exact recording code (ISRC)",
  exact: "same title and artist",
  fuzzy_jaro_winkler: "similar title and artist",
  cache: "remembered match",
  manual: "picked by you",
  none: "",
};
const STATUS_PILL = {
  QUEUED: ["warn", "Starting"],
  RUNNING: ["warn", "Moving"],
  WAITING: ["warn", "Paused"],
  DONE: ["ok", "Done"],
  FAILED: ["bad", "Failed"],
  CANCELLED: ["", "Stopped"],
};

let job = null;
let filter = { status: "", already: false };
let offset = 0;
let finished = false;
let polling = false;

function renderJob() {
  $("#title").textContent = job.title;
  $("#route").textContent = `${platformName(job.source)} → ${platformName(job.dest)}`;
  const [tone, label] = STATUS_PILL[job.status] ?? ["", job.status];
  $("#status-pill").className = `pill ${tone}`;
  $("#status-pill").textContent = label;

  const c = job.counts;
  const checked = job.total - c.PENDING;
  $("#n-total").textContent = job.total.toLocaleString();
  $("#n-matched").textContent = c.MATCHED.toLocaleString();
  $("#n-low").textContent = c.LOW_CONFIDENCE.toLocaleString();
  $("#n-failed").textContent = c.FAILED.toLocaleString();
  $("#n-already").textContent = job.alreadyThere.toLocaleString();

  // Progress = half for checking songs, half for adding the matched ones.
  const handled = job.written + job.alreadyThere;
  let percent = 0;
  if (job.status === "DONE") percent = 100;
  else if (job.total) percent = Math.round(((checked / job.total) * 0.5 + (c.MATCHED ? handled / c.MATCHED : 0) * 0.5) * 100);
  percent = Math.min(100, percent);
  $("#bar > span").style.width = `${percent}%`;
  $("#bar").setAttribute("aria-valuenow", String(percent));
  $("#percent").textContent = `${percent}%`;

  let phase = "Reading your songs…";
  if (job.status === "DONE") phase = "All done!";
  else if (job.status === "FAILED") phase = "Stopped by a problem";
  else if (job.status === "CANCELLED") phase = "Stopped";
  else if (job.status === "WAITING") phase = "Paused for a moment";
  else if (checked < job.total) phase = `Finding songs on ${platformName(job.dest)}… (${checked.toLocaleString()} of ${job.total.toLocaleString()})`;
  else if (job.total) phase = `Adding songs to ${platformName(job.dest)}…`;
  $("#phase").textContent = phase;

  let message = job.message ?? "";
  if (job.status === "CANCELLED") {
    message = job.written
      ? `Stopped. The ${plural(job.written, "song")} already added will stay in your ${job.playlists.length > 1 ? "playlists" : "playlist"}.`
      : "Stopped before any songs were added. Nothing was changed.";
  }
  $("#message").textContent = message;
  $("#message").classList.toggle("hidden", !message);

  finished = ["DONE", "FAILED", "CANCELLED"].includes(job.status);
  $("#stop").classList.toggle("hidden", finished);

  const summary = summaryText();
  $("#summary").textContent = summary;
  $("#summary").classList.toggle("hidden", !(finished && summary));

  const somethingToRetry = c.FAILED > 0 || c.LOW_CONFIDENCE > 0 || job.status !== "DONE";
  $("#retry-box").classList.toggle("hidden", !(finished && somethingToRetry));
  renderSyncBox();
}

function summaryText() {
  if (!job.written && !job.alreadyThere) return "";
  const where = job.playlists.length === 1 && job.playlists[0].kind === "playlist" ? ` to ${job.playlists[0].name}` : "";
  const added = `Added ${plural(job.written, "song")}${where}.`;
  return job.alreadyThere ? `${added} ${plural(job.alreadyThere, "song")} ${job.alreadyThere === 1 ? "was" : "were"} already there.` : added;
}

// ---------- Keep in sync (v1.2) ----------

function renderSyncBox() {
  const playlists = job.playlists.filter((p) => p.kind === "playlist" && p.dest_playlist_id);
  const can = job.status === "DONE" && job.source !== "file" && !job.sync_id && playlists.length;
  $("#sync-box").classList.toggle("hidden", !can);
  if (!can) return;
  if (job.dest === "youtube") {
    $("#sync-buttons").replaceChildren(
      el("p", { class: "muted small" }, "Syncing into YouTube is switched off for now: its small daily allowance is shared by everyone."),
    );
    return;
  }
  $("#sync-buttons").replaceChildren(
    ...playlists.map((p) =>
      el("button", { class: "btn btn-small", type: "button", onclick: (e) => keepInSync(p, e.currentTarget) }, `Keep “${p.name}” in sync`),
    ),
  );
}

async function keepInSync(playlist, button) {
  button.disabled = true;
  try {
    await api("/api/syncs", { method: "POST", body: { jobId, selIndex: playlist.sel_index } });
    button.textContent = `“${playlist.name}” is kept in sync ✓`;
    toast("Done! New songs will be copied once a day. See Syncs on your dashboard.");
  } catch (err) {
    button.disabled = false;
    toast(err.message);
  }
}

// ---------- table ----------

function itemRow(item) {
  let [tone, label] = RESULT_LABEL[item.status] ?? ["", item.status];
  if (item.written === 2) [tone, label] = ["", "Already there"];
  if (item.status === "PENDING" && finished) label = "Not checked yet";
  const confidence = item.confidence && item.method !== "manual" ? ` · ${Math.round(item.confidence * 100)}% sure` : "";
  const canFix = FIXABLE.includes(item.status) && item.written === 0;
  return el(
    "tr",
    { "data-id": item.id },
    el("td", { class: "muted" }, item.position + 1),
    el("td", {}, el("div", {}, item.src_title), el("div", { class: "sub" }, item.src_artist)),
    el(
      "td",
      {},
      item.dest_title
        ? [el("div", {}, item.dest_title), el("div", { class: "sub" }, item.dest_artist ?? "")]
        : el("span", { class: "muted" }, "—"),
    ),
    el(
      "td",
      {},
      el("span", { class: `pill ${tone}` }, label),
      el("div", { class: "sub" }, `${METHOD_LABEL[item.method] ?? ""}${confidence}`),
      canFix
        ? el(
            "button",
            { class: "btn btn-small fix-btn", type: "button", onclick: (e) => openFix(item, e.currentTarget), "aria-label": `Fix ${item.src_title}` },
            "Fix",
          )
        : null,
    ),
  );
}

async function loadItems(reset = false) {
  if (reset) {
    offset = 0;
    $("#items").replaceChildren();
  }
  const q = new URLSearchParams({ offset: String(offset) });
  if (filter.status) q.set("status", filter.status);
  if (filter.already) q.set("filter", "already");
  const page = await api(`/api/jobs/${jobId}/items?${q}`);
  $("#items").append(...page.items.map(itemRow));
  offset += page.items.length;
  $("#more").classList.toggle("hidden", !page.hasMore);
  if (!offset) $("#items").replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "muted" }, "Nothing here yet.")));
}

async function refreshJob() {
  job = await api(`/api/jobs/${jobId}`);
  renderJob();
}

async function poll() {
  if (polling) return;
  polling = true;
  while (true) {
    try {
      await refreshJob();
      if (finished) {
        await loadItems(true);
        break;
      }
    } catch (err) {
      toast(err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  polling = false;
}

$("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[role=tab]");
  if (!button) return;
  filter = { status: button.dataset.status ?? "", already: button.dataset.filter === "already" };
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b === button)));
  loadItems(true);
});
$("#more").addEventListener("click", () => loadItems());

// ---------- Stop / Try again ----------

$("#stop").addEventListener("click", async () => {
  if (!confirm("Stop moving songs? Songs already added will stay.")) return;
  $("#stop").disabled = true;
  try {
    await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    await refreshJob();
    await loadItems(true);
  } catch (err) {
    toast(err.message);
  } finally {
    $("#stop").disabled = false;
  }
});

$("#retry").addEventListener("click", async () => {
  $("#retry").disabled = true;
  try {
    await api(`/api/jobs/${jobId}/retry`, { method: "POST", body: { includeUnsure: $("#include-unsure").checked } });
    toast("Trying again…");
    poll();
  } catch (err) {
    toast(err.message);
  } finally {
    $("#retry").disabled = false;
  }
});

// ---------- Fix a song by hand ----------

let fixing = null; // { item, button }

function openFix(item, button) {
  fixing = { item, button };
  $("#fix-original").textContent = `Original: ${item.src_title} — ${item.src_artist}`;
  $("#fix-q").value = `${item.src_title} ${item.src_artist}`.slice(0, 200);
  $("#fix-youtube").classList.toggle("hidden", job.dest !== "youtube");
  $("#fix-results").replaceChildren();
  $("#fix-status").textContent = "";
  $("#fix").showModal();
  $("#fix-q").focus();
  $("#fix-q").select();
  if (job.dest !== "youtube") runSearch(); // YouTube searches cost a lot: only search when asked
}

function closeFix() {
  if ($("#fix").open) $("#fix").close();
}

$("#fix").addEventListener("close", () => {
  // Focus goes back to where the user was: the row's Fix button (or its replacement row).
  const back = fixing?.button?.isConnected ? fixing.button : document.querySelector(`#items tr[data-id="${fixing?.item.id}"] button`);
  back?.focus();
  fixing = null;
});
$("#fix-close").addEventListener("click", closeFix);
$("#fix-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

let searchTimer;
$("#fix-q").addEventListener("input", () => {
  if (job.dest === "youtube") return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 400);
});

async function runSearch() {
  if (!fixing) return;
  const { item } = fixing;
  $("#fix-status").replaceChildren(el("span", { class: "spinner" }), " Searching…");
  try {
    const q = encodeURIComponent($("#fix-q").value.trim());
    const { results } = await api(`/api/jobs/${jobId}/items/${item.id}/search?q=${q}`);
    if (fixing?.item !== item) return;
    $("#fix-status").textContent = results.length ? `${plural(results.length, "result")}` : "No songs found. Try different words.";
    $("#fix-results").replaceChildren(
      ...results.map((r) =>
        el(
          "li",
          {},
          el(
            "button",
            { class: "btn pick", type: "button", onclick: () => useSong(r) },
            el("span", {}, el("strong", {}, r.title), el("div", { class: "sub" }, [r.artist, r.album].filter(Boolean).join(" · "))),
            el("span", { class: "small" }, "Use this"),
          ),
        ),
      ),
    );
  } catch (err) {
    $("#fix-status").textContent = err.message;
  }
}

async function useSong(song) {
  const { item } = fixing;
  try {
    const res = await api(`/api/jobs/${jobId}/items/${item.id}/fix`, {
      method: "POST",
      body: { destId: song.id, destTitle: song.title, destArtist: song.artist },
    });
    const updated = { ...item, status: "MATCHED", method: "manual", confidence: 1, dest_title: song.title, dest_artist: song.artist, written: res.written };
    replaceRow(item, updated);
    toast(res.written === 2 ? "That song is already in the playlist." : res.note ?? (res.written ? "Added!" : "Saved. It will be added in a moment."));
    closeFix();
    refreshJob().catch(() => {});
  } catch (err) {
    $("#fix-status").textContent = err.message;
  }
}

$("#fix-skip").addEventListener("click", async () => {
  const { item } = fixing;
  try {
    await api(`/api/jobs/${jobId}/items/${item.id}/skip`, { method: "POST" });
    replaceRow(item, { ...item, status: "SKIPPED" });
    closeFix();
    refreshJob().catch(() => {});
  } catch (err) {
    $("#fix-status").textContent = err.message;
  }
});

function replaceRow(item, updated) {
  const row = document.querySelector(`#items tr[data-id="${item.id}"]`);
  if (row) row.replaceWith(itemRow(updated));
}

// ---------- CSV of songs to check ----------

$("#download-missing").addEventListener("click", async () => {
  const rows = [];
  for (const status of ["LOW_CONFIDENCE", "FAILED"]) {
    let start = 0;
    let more = true;
    while (more) {
      const page = await api(`/api/jobs/${jobId}/items?status=${status}&offset=${start}`);
      rows.push(...page.items);
      start += page.items.length;
      more = page.hasMore;
    }
  }
  if (!rows.length) return toast("Every song matched — nothing to download.");
  const tracks = rows.map((r) => ({ title: r.src_title, artist: r.src_artist, album: r.src_album, isrc: r.src_isrc }));
  downloadFile("mixnmatch-songs-to-check.csv", toCsv([{ name: "Songs to check", tracks }]), "text/csv");
});

if (!jobId) {
  location.replace("/dashboard");
} else {
  loadUser()
    .then(() => {
      poll();
      loadItems(true);
    })
    .catch((err) => toast(err.message));
}

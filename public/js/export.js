// Back-up page: reads playlists page by page in the browser, then saves them as a file.
// Doing the work here (not on the server) keeps every server request small and cheap.
import { api, fetchAllPages } from "./api.js";
import { toBackupJson, toCsv } from "./formats.js";
import { $, downloadFile, el, loadUser, platformName, plural, toast } from "./ui.js";

const LIKED = "__liked__";
let playlists = [];
let nextCursor;
const selected = new Set();

function card(item) {
  const isSelected = selected.has(item.id);
  return el(
    "div",
    {
      class: `cover-card${isSelected ? " selected" : ""}${item.id === LIKED ? " liked" : ""}`,
      role: "checkbox",
      tabindex: "0",
      "aria-checked": String(isSelected),
      onclick: () => toggle(item.id),
      onkeydown: (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle(item.id)),
    },
    el(
      "div",
      { class: "art" },
      item.imageUrl ? el("img", { src: item.imageUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : item.id === LIKED ? "♥" : "♪",
    ),
    el("span", { class: "check" }, "✓"),
    el("div", { class: "meta" }, el("div", { class: "name" }, item.name), el("div", { class: "muted small" }, item.trackCount != null ? plural(item.trackCount, "song") : "Songs")),
  );
}

function toggle(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}

function render() {
  $("#playlist-grid").replaceChildren(...playlists.map(card));
  $("#load-more").classList.toggle("hidden", !nextCursor);
  $("#download").disabled = selected.size === 0;
}

async function load(more = false) {
  const platform = $("#platform").value;
  if (!platform) return;
  if (!more) {
    playlists = [{ id: LIKED, name: "Liked Songs" }];
    selected.clear();
    nextCursor = undefined;
  }
  $("#pick-status").replaceChildren(el("span", { class: "spinner" }), " Loading…");
  try {
    const page = await api(`/api/library/${platform}/playlists${nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ""}`);
    playlists.push(...page.items);
    nextCursor = page.next;
    $("#pick-status").textContent = "Tap the playlists you want in your backup.";
  } catch (err) {
    $("#pick-status").textContent = err.message;
  }
  render();
}

$("#platform").addEventListener("change", () => load());
$("#load-more").addEventListener("click", () => load(true));
$("#select-all").addEventListener("click", () => {
  playlists.forEach((p) => selected.add(p.id));
  render();
});

$("#download").addEventListener("click", async () => {
  const platform = $("#platform").value;
  const chosen = playlists.filter((p) => selected.has(p.id));
  const progress = $("#progress");
  progress.classList.remove("hidden");
  $("#download").disabled = true;
  try {
    const result = [];
    for (const [i, p] of chosen.entries()) {
      const path =
        p.id === LIKED ? `/api/library/${platform}/liked` : `/api/library/${platform}/playlists/${encodeURIComponent(p.id)}/tracks`;
      const tracks = await fetchAllPages(path, (n) => {
        progress.textContent = `Reading “${p.name}” (${i + 1} of ${chosen.length}): ${plural(n, "song")}…`;
      });
      result.push({ name: p.name, tracks });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `mixnmatch-${platform}-${stamp}`;
    if ($("#format").value === "csv") downloadFile(`${base}.csv`, toCsv(result), "text/csv");
    else downloadFile(`${base}.${result.length === 1 ? "jspf" : "json"}`, toBackupJson(result), "application/json");
    const total = result.reduce((n, p) => n + p.tracks.length, 0);
    progress.textContent = `Saved ${plural(result.length, "playlist")} with ${plural(total, "song")}.`;
  } catch (err) {
    progress.textContent = err.message;
  } finally {
    $("#download").disabled = selected.size === 0;
  }
});

loadUser()
  .then((me) => {
    if (!me.connections.length) {
      $("#pick-status").replaceChildren("Connect a music app first. ", el("a", { href: "/dashboard" }, "Go to dashboard"));
      return;
    }
    $("#platform").replaceChildren(...me.connections.map((c) => el("option", { value: c.platform }, platformName(c.platform))));
    load();
  })
  .catch((err) => toast(err.message));

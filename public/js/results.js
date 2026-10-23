// Live progress for one transfer, plus the per-song results table.
import { api } from "./api.js";
import { toCsv } from "./formats.js";
import { $, downloadFile, el, loadUser, platformName, toast } from "./ui.js";

const jobId = new URLSearchParams(location.search).get("job");
const POLL_MS = 2000;

const RESULT_LABEL = {
  PENDING: ["", "Waiting"],
  MATCHED: ["ok", "Matched"],
  LOW_CONFIDENCE: ["warn", "Need a look"],
  FAILED: ["bad", "Not found"],
};
const METHOD_LABEL = {
  isrc: "exact recording code (ISRC)",
  exact: "same title and artist",
  fuzzy_jaro_winkler: "similar title and artist",
  cache: "remembered match",
  none: "",
};
const STATUS_PILL = {
  QUEUED: ["warn", "Starting"],
  RUNNING: ["warn", "Moving"],
  WAITING: ["warn", "Paused"],
  DONE: ["ok", "Done"],
  FAILED: ["bad", "Failed"],
};

let filter = "";
let offset = 0;
let finished = false;

function renderJob(job) {
  $("#title").textContent = job.title;
  $("#route").textContent = `${platformName(job.source)} → ${platformName(job.dest)}`;
  const [tone, label] = STATUS_PILL[job.status] ?? ["", job.status];
  $("#status-pill").className = `pill ${tone}`;
  $("#status-pill").textContent = label;

  const c = job.counts;
  const checked = c.MATCHED + c.LOW_CONFIDENCE + c.FAILED;
  $("#n-total").textContent = job.total.toLocaleString();
  $("#n-matched").textContent = c.MATCHED.toLocaleString();
  $("#n-low").textContent = c.LOW_CONFIDENCE.toLocaleString();
  $("#n-failed").textContent = c.FAILED.toLocaleString();

  // Progress = half for checking songs, half for adding the matched ones.
  let percent = 0;
  if (job.status === "DONE") percent = 100;
  else if (job.total) percent = Math.round(((checked / job.total) * 0.5 + (c.MATCHED ? job.written / c.MATCHED : 0) * 0.5) * 100);
  $("#bar > span").style.width = `${percent}%`;
  $("#bar").setAttribute("aria-valuenow", String(percent));
  $("#percent").textContent = `${percent}%`;

  let phase = "Reading your songs…";
  if (job.status === "DONE") phase = "All done!";
  else if (job.status === "FAILED") phase = "Stopped";
  else if (job.status === "WAITING") phase = "Paused for a moment";
  else if (checked < job.total) phase = `Finding songs on ${platformName(job.dest)}… (${checked.toLocaleString()} of ${job.total.toLocaleString()})`;
  else if (job.total) phase = `Adding songs to ${platformName(job.dest)}…`;
  $("#phase").textContent = phase;

  $("#message").textContent = job.message ?? "";
  $("#message").classList.toggle("hidden", !job.message);
  finished = job.status === "DONE" || job.status === "FAILED";
}

function itemRow(item) {
  const [tone, label] = RESULT_LABEL[item.status] ?? ["", item.status];
  const confidence = item.confidence ? ` · ${Math.round(item.confidence * 100)}% sure` : "";
  return el(
    "tr",
    {},
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
    ),
  );
}

async function loadItems(reset = false) {
  if (reset) {
    offset = 0;
    $("#items").replaceChildren();
  }
  const q = new URLSearchParams({ offset: String(offset) });
  if (filter) q.set("status", filter);
  const page = await api(`/api/jobs/${jobId}/items?${q}`);
  $("#items").append(...page.items.map(itemRow));
  offset += page.items.length;
  $("#more").classList.toggle("hidden", !page.hasMore);
  if (!offset) $("#items").replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "muted" }, "Nothing here yet.")));
}

async function poll() {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    renderJob(job);
    if (finished) return loadItems(true);
  } catch (err) {
    toast(err.message);
  }
  setTimeout(poll, POLL_MS);
}

$("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  filter = button.dataset.status;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b === button)));
  loadItems(true);
});
$("#more").addEventListener("click", () => loadItems());

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

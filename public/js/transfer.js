// The transfer wizard: From -> To -> Choose -> Review -> start.
import { api } from "./api.js";
import { parseImport } from "./formats.js";
import { $, el, loadUser, platformDot, platformName, plural, toast } from "./ui.js";

const LIKED = "__liked__";
const PREVIEW_LIMIT = 50;

const state = {
  step: 1,
  me: null,
  source: null, // platform id or "file"
  dest: null,
  playlists: [], // loaded from the source
  nextCursor: undefined,
  selected: new Set(), // playlist ids (or LIKED)
  file: null, // { name, playlists: [{ name, tracks }] }
  destPlaylists: null, // destination playlists for "Add to": null = not asked yet, undefined = loading, [] = loaded
  destCursor: undefined,
  targets: new Map(), // source playlist id -> destination playlist id ("" = new playlist)
};
const MORE = "__more__";

const connected = () => state.me.connections.map((c) => c.platform);

// ---------- step 1 & 2: tiles ----------

function tile(id, title, subtitle, pressed, onclick, disabled = false) {
  return el(
    "button",
    { class: `tile c-${id}`, "aria-pressed": pressed ? "true" : "false", onclick, disabled, type: "button", "data-id": id },
    platformDot(id),
    el("span", {}, el("div", { class: "title" }, title), el("div", { class: "muted small" }, subtitle)),
  );
}

function renderSources() {
  const tiles = connected().map((id) =>
    tile(id, platformName(id), "Connected", state.source === id, () => chooseSource(id)),
  );
  tiles.push(tile("file", "Upload a file", "JSPF, CSV or TXT backup", state.source === "file", () => chooseSource("file")));
  $("#source-tiles").replaceChildren(...tiles);
  $("#file-box").classList.toggle("hidden", state.source !== "file");
}

function chooseSource(id) {
  if (state.source !== id) {
    state.source = id;
    state.playlists = [];
    state.selected.clear();
    state.nextCursor = undefined;
    if (state.dest === id && id !== "mock") state.dest = null;
  }
  renderSources();
  updateButtons();
}

function renderDests() {
  const options = connected().filter((id) => id !== state.source || id === "mock");
  if (!options.length) {
    $("#dest-tiles").replaceChildren(
      el("p", { class: "muted" }, "Connect a second music app first. ", el("a", { href: "/dashboard" }, "Go to dashboard")),
    );
  } else {
    $("#dest-tiles").replaceChildren(
      ...options.map((id) =>
        tile(id, platformName(id), "Songs will be added here", state.dest === id, () => {
          if (state.dest !== id) {
            state.destPlaylists = null;
            state.destCursor = undefined;
            state.targets.clear();
          }
          state.dest = id;
          renderDests();
          updateButtons();
        }),
      ),
    );
  }
  $("#youtube-note").classList.toggle("hidden", state.dest !== "youtube");
}

// ---------- file upload ----------

$("#file").addEventListener("change", async () => {
  const file = $("#file").files[0];
  state.file = null;
  $("#file-summary").replaceChildren();
  if (!file) return updateButtons();
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is too big (5 MB max).");
    const playlists = parseImport(await file.text(), file.name);
    if (!playlists.length) throw new Error("No songs found in that file.");
    state.file = { name: file.name, playlists };
    const total = playlists.reduce((n, p) => n + p.tracks.length, 0);
    $("#file-summary").replaceChildren(
      el("p", { class: "notice ok" }, `Found ${plural(playlists.length, "playlist")} with ${plural(total, "song")}.`),
    );
  } catch (err) {
    $("#file-summary").replaceChildren(el("p", { class: "notice bad" }, err.message || "Could not read that file."));
  }
  updateButtons();
});

// ---------- step 3: playlists ----------

function coverCard(item) {
  const selected = state.selected.has(item.id);
  const art = item.imageUrl
    ? el("img", { src: item.imageUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
    : item.id === LIKED
      ? "♥"
      : (item.name?.[0] ?? "♪").toUpperCase();
  const card = el(
    "div",
    {
      class: `cover-card${selected ? " selected" : ""}${item.id === LIKED ? " liked" : ""}`,
      role: "checkbox",
      "aria-checked": selected ? "true" : "false",
      tabindex: "0",
      onclick: () => toggle(item.id),
      onkeydown: (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle(item.id);
        }
      },
    },
    el("div", { class: "art" }, art),
    el("span", { class: "check" }, "✓"),
    el(
      "div",
      { class: "meta" },
      el("div", { class: "name", title: item.name }, item.name),
      el("div", { class: "muted small" }, item.trackCount != null ? plural(item.trackCount, "song") : "Songs"),
    ),
  );
  if (state.source !== "file") {
    card.append(
      el(
        "button",
        {
          class: "btn btn-small peek",
          type: "button",
          onclick: (e) => {
            e.stopPropagation();
            peek(item);
          },
        },
        "Peek",
      ),
    );
  }
  return card;
}

function toggle(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderPlaylists();
  updateButtons();
}

function renderPlaylists() {
  $("#playlist-grid").replaceChildren(...state.playlists.map(coverCard));
  $("#load-more").classList.toggle("hidden", !state.nextCursor);
}

async function loadPlaylists(more = false) {
  if (state.source === "file") {
    state.playlists = state.file.playlists.map((p, i) => ({ id: String(i), name: p.name, trackCount: p.tracks.length }));
    if (!state.selected.size) state.playlists.forEach((p) => state.selected.add(p.id));
    $("#pick-status").textContent = "These playlists are in your file.";
    renderPlaylists();
    return;
  }
  if (!more) {
    state.playlists = [{ id: LIKED, name: "Liked Songs" }];
    state.nextCursor = undefined;
  }
  $("#pick-status").replaceChildren(el("span", { class: "spinner" }), " Loading your playlists…");
  try {
    const q = state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : "";
    const page = await api(`/api/library/${state.source}/playlists${q}`);
    state.playlists.push(...page.items);
    state.nextCursor = page.next;
    $("#pick-status").textContent = `Tap a playlist to select it. ${plural(state.playlists.length - 1, "playlist")} found.`;
  } catch (err) {
    $("#pick-status").textContent = err.message;
  }
  renderPlaylists();
}

async function peek(item) {
  $("#peek-title").textContent = item.name;
  $("#peek-list").replaceChildren(el("li", {}, el("span", { class: "spinner" })));
  $("#peek").showModal();
  try {
    const path =
      item.id === LIKED
        ? `/api/library/${state.source}/liked`
        : `/api/library/${state.source}/playlists/${encodeURIComponent(item.id)}/tracks`;
    const page = await api(path);
    const songs = page.items.slice(0, PREVIEW_LIMIT);
    $("#peek-list").replaceChildren(
      ...songs.map((t, i) =>
        el("li", {}, el("span", { class: "pos" }, i + 1), el("span", {}, el("strong", {}, t.title), el("div", { class: "muted small" }, t.artist))),
      ),
    );
    if (!songs.length) $("#peek-list").replaceChildren(el("li", {}, "This list is empty."));
    else if (page.next) $("#peek-list").append(el("li", { class: "muted" }, "…and more"));
  } catch (err) {
    $("#peek-list").replaceChildren(el("li", {}, err.message));
  }
}

$("#peek-close").addEventListener("click", () => $("#peek").close());
$("#load-more").addEventListener("click", () => loadPlaylists(true));
$("#select-all").addEventListener("click", () => {
  state.playlists.forEach((p) => state.selected.add(p.id));
  renderPlaylists();
  updateButtons();
});
$("#select-none").addEventListener("click", () => {
  state.selected.clear();
  renderPlaylists();
  updateButtons();
});

// ---------- step 4: review ----------

function chosen() {
  return state.playlists.filter((p) => state.selected.has(p.id));
}

async function loadDestPlaylists() {
  try {
    const q = state.destCursor ? `?cursor=${encodeURIComponent(state.destCursor)}` : "";
    const page = await api(`/api/library/${state.dest}/playlists${q}`);
    state.destPlaylists = [...(state.destPlaylists ?? []), ...page.items];
    state.destCursor = page.next;
  } catch {
    state.destPlaylists = state.destPlaylists ?? [];
    state.destCursor = undefined;
  }
  renderSummary();
}

/** "New playlist" or "Add to: <one of your playlists on the new app>". */
function targetPicker(item) {
  const select = el(
    "select",
    { class: "select-small", "aria-label": `Where should “${item.name}” go?` },
    el("option", { value: "" }, "New playlist"),
    state.destPlaylists === null ? el("option", { value: "", disabled: true }, "Loading your playlists…") : null,
    (state.destPlaylists ?? []).map((p) => el("option", { value: p.id }, `Add to: ${p.name}`)),
    state.destCursor ? el("option", { value: MORE }, "Show more playlists…") : null,
  );
  select.value = state.targets.get(item.id) ?? "";
  select.addEventListener("change", () => {
    if (select.value === MORE) {
      select.value = state.targets.get(item.id) ?? "";
      loadDestPlaylists();
      return;
    }
    state.targets.set(item.id, select.value);
  });
  return select;
}

function renderSummary() {
  const items = chosen();
  const songs = items.reduce((n, p) => n + (p.trackCount ?? 0), 0);
  $("#summary").replaceChildren(
    el(
      "div",
      { class: "row" },
      platformDot(state.source),
      el("strong", {}, platformName(state.source)),
      el("span", { class: "muted" }, "→"),
      platformDot(state.dest),
      el("strong", {}, platformName(state.dest)),
    ),
    el("p", {}, `${plural(items.length, "list")}${songs ? `, about ${plural(songs, "song")}` : ""}:`),
    el(
      "ul",
      { class: "review-list" },
      items.map((p) =>
        el("li", {}, el("span", {}, p.name), p.id === LIKED ? el("span", { class: "muted small" }, "Saved to your liked songs") : targetPicker(p)),
      ),
    ),
    el("p", { class: "muted small" }, "Adding to a playlist you already have? Songs that are already in it are skipped, so nothing is added twice."),
  );
  if (state.destPlaylists === null && items.some((p) => p.id !== LIKED)) {
    state.destPlaylists = undefined; // loading
    loadDestPlaylists();
  }
}

async function start() {
  const button = $("#next");
  button.disabled = true;
  button.textContent = "Starting…";
  $("#error").classList.add("hidden");
  try {
    const body = { source: state.source, dest: state.dest };
    if (state.source === "file") {
      body.file = {
        name: state.file.name,
        playlists: chosen().map((p) => ({ ...state.file.playlists[Number(p.id)], targetPlaylistId: state.targets.get(p.id) || undefined })),
      };
    } else {
      body.selections = chosen().map((p) =>
        p.id === LIKED ? { kind: "liked" } : { kind: "playlist", id: p.id, name: p.name, targetPlaylistId: state.targets.get(p.id) || undefined },
      );
    }
    const { id } = await api("/api/jobs", { method: "POST", body });
    location.href = `/results?job=${id}`;
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").classList.remove("hidden");
    button.disabled = false;
    button.textContent = "Start transfer";
  }
}

// ---------- navigation ----------

function canContinue() {
  if (state.step === 1) return state.source && (state.source !== "file" || state.file);
  if (state.step === 2) return !!state.dest;
  if (state.step === 3) return state.selected.size > 0;
  return true;
}

function updateButtons() {
  $("#next").disabled = !canContinue();
  $("#next").textContent = state.step === 4 ? "Start transfer" : "Next";
  $("#back").classList.toggle("hidden", state.step === 1);
}

function show(step) {
  state.step = step;
  for (let i = 1; i <= 4; i++) $(`#step-${i}`).classList.toggle("hidden", i !== step);
  document.querySelectorAll("#stepper li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
  });
  if (step === 2) renderDests();
  if (step === 3 && !state.playlists.length) loadPlaylists();
  if (step === 4) renderSummary();
  updateButtons();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#next").addEventListener("click", () => (state.step === 4 ? start() : show(state.step + 1)));
$("#back").addEventListener("click", () => show(state.step - 1));

loadUser()
  .then((me) => {
    state.me = me;
    if (!me.connections.length) $("#connect-hint").replaceChildren("Connect at least one music app first. ", el("a", { href: "/dashboard" }, "Go to dashboard"));
    renderSources();
    show(1);
  })
  .catch((err) => toast(err.message));

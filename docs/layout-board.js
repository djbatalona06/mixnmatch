// Behaviour for docs/layout-board.html and the generated test-results/layout/report.html:
// tabs (one per screen) and, on the board only, the phone / tablet / desktop switch.
//
// How the board describes a layout (all in the HTML):
//   <div class="grid" data-cols="12">              12 equal columns at every width
//   <div class="grid" data-cols-p="2" data-cols-t="3" data-cols-d="5">   columns per width
//   <div class="part" data-p="12" data-t="6" data-d="4">   spans 12, 6 or 4 columns
//   data-d="5 / 9"   starts at line 5 and ends at line 9;   data-p="none"   hidden at that width
(() => {
  const WIDTHS = { phone: 375, tablet: 768, desktop: 1280 };
  const KEY = { phone: "p", tablet: "t", desktop: "d" };
  let width = "phone";

  // ---------- the phone / tablet / desktop switch ----------

  function placeText(value, cols) {
    if (value === "none") return "hidden at this width";
    if (/^\d+$/.test(value)) return value === String(cols) ? `full width (${cols} of ${cols})` : `${value} of ${cols} columns`;
    const [a, b] = value.split("/").map((n) => parseInt(n, 10));
    return `columns ${a}–${b - 1} of ${cols}`;
  }

  function layout() {
    const k = KEY[width];
    for (const el of document.querySelectorAll("[data-p], [data-t], [data-d]")) {
      const value = el.dataset[k] ?? "show";
      el.hidden = value === "none";
      const grid = el.parentElement.closest(".grid");
      if (!grid || !el.classList.contains("part")) continue;
      const cols = Number(grid.dataset.cols ?? grid.dataset[`cols${k.toUpperCase()}`] ?? 12);
      if (value !== "none" && value !== "show") el.style.gridColumn = /^\d+$/.test(value) ? `span ${value}` : value;
      let place = el.querySelector(":scope > .place");
      if (!place) {
        place = document.createElement("span");
        place.className = "place";
        el.insertBefore(place, el.children[0] ?? null); // after the part's name, before its notes
      }
      place.textContent = placeText(value, cols);
    }
    for (const grid of document.querySelectorAll(".grid")) {
      const cols = grid.dataset.cols ?? grid.dataset[`cols${k.toUpperCase()}`];
      if (cols) grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    }
    // Draw each device at its real size in pixels, then shrink it to fit the window.
    for (const frame of document.querySelectorAll(".frame")) {
      frame.style.width = `${WIDTHS[width]}px`;
      const room = frame.parentElement.clientWidth;
      frame.style.zoom = room ? String(Math.min(1, room / (WIDTHS[width] + 4))) : "1";
    }
    for (const button of document.querySelectorAll(".widths button")) button.setAttribute("aria-pressed", String(button.dataset.width === width));
    for (const out of document.querySelectorAll("[data-width-name]")) out.textContent = `${width} (${WIDTHS[width]}px)`;
  }

  for (const button of document.querySelectorAll(".widths button")) {
    button.addEventListener("click", () => {
      width = button.dataset.width;
      layout();
    });
  }

  // The faint 12 columns behind each screen's content.
  for (const grid of document.querySelectorAll(".grid[data-overlay]")) {
    const cols = document.createElement("div");
    cols.className = "cols";
    cols.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 12; i++) cols.appendChild(document.createElement("span"));
    grid.prepend(cols);
  }

  // ---------- tabs ----------

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function select(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    history.replaceState(null, "", `#${tab.id.replace(/^tab-/, "")}`);
    layout();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });

  window.addEventListener("resize", layout);
  if (tabs.length) select(tabs.find((t) => t.id === `tab-${location.hash.slice(1)}`) ?? tabs[0]);
  else layout();
})();

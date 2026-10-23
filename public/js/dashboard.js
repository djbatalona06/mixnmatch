// Dashboard: connected services, recent transfers, delete account.
import { api } from "./api.js";
import { $, el, formatDate, loadUser, platformDot, platformName, toast } from "./ui.js";

const STATUS_PILL = {
  QUEUED: ["warn", "Starting"],
  RUNNING: ["warn", "Moving"],
  WAITING: ["warn", "Paused"],
  DONE: ["ok", "Done"],
  FAILED: ["bad", "Failed"],
};

const ERRORS = {
  denied: "You cancelled the connection, so nothing was changed.",
  expired: "That took too long. Please try connecting again.",
  failed: "We couldn't finish connecting. Please try again.",
};

function showFlash() {
  const params = new URLSearchParams(location.search);
  const flash = $("#flash");
  if (params.get("connected")) {
    flash.textContent = `${platformName(params.get("connected"))} is connected.`;
    flash.className = "notice ok";
  } else if (params.get("error")) {
    flash.textContent = `${platformName(params.get("platform") ?? "")}: ${ERRORS[params.get("error")] ?? "Something went wrong."}`;
    flash.className = "notice bad";
  }
  if (params.toString()) history.replaceState(null, "", "/dashboard");
}

function serviceCard(platform, connection) {
  const body = [];
  if (!platform.configured) {
    body.push(el("p", { class: "account" }, "Not switched on for this server yet."));
    body.push(el("div", {}, el("button", { class: "btn btn-small", disabled: true }, "Coming soon")));
  } else if (connection) {
    body.push(el("p", { class: "account" }, `Connected as ${connection.accountName ?? "your account"}`));
    body.push(
      el(
        "div",
        { class: "row" },
        el("span", { class: "pill ok" }, "Connected"),
        el("button", { class: "btn btn-small btn-ghost", onclick: () => disconnect(platform) }, "Disconnect"),
      ),
    );
  } else {
    body.push(el("p", { class: "account" }, "Not connected"));
    body.push(el("div", {}, el("a", { class: "btn btn-small btn-primary", href: `/api/connect/${platform.id}` }, `Connect ${platform.name}`)));
  }
  return el(
    "div",
    { class: `card platform-card c-${platform.id}` },
    el("div", { class: "head" }, platformDot(platform.id), el("span", { class: "name" }, platform.name)),
    ...body,
  );
}

async function disconnect(platform) {
  if (!confirm(`Disconnect ${platform.name}? mix n match will forget its access key. Your music on ${platform.name} is not changed.`)) return;
  await api(`/api/connections/${platform.id}`, { method: "DELETE" });
  toast(`${platform.name} disconnected`);
  render();
}

async function renderJobs() {
  const { jobs } = await api("/api/jobs");
  if (!jobs.length) return;
  $("#jobs").replaceChildren(
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", {}, "What"), el("th", {}, "From → To"), el("th", {}, "When"), el("th", {}, "Status"))),
        el(
          "tbody",
          {},
          jobs.map((job) => {
            const [tone, label] = STATUS_PILL[job.status] ?? ["", job.status];
            return el(
              "tr",
              {},
              el("td", {}, el("a", { href: `/results?job=${job.id}` }, job.title)),
              el("td", {}, `${platformName(job.source)} → ${platformName(job.dest)}`),
              el("td", {}, formatDate(job.created_at)),
              el("td", {}, el("span", { class: `pill ${tone}` }, label)),
            );
          }),
        ),
      ),
    ),
  );
}

async function render() {
  const me = await loadUser();
  const byPlatform = Object.fromEntries(me.connections.map((c) => [c.platform, c]));
  $("#services").replaceChildren(...me.platforms.map((p) => serviceCard(p, byPlatform[p.id])));
  const canTransfer = me.connections.length > 0;
  $("#start-transfer").classList.toggle("hidden", !canTransfer);
  await renderJobs();
}

$("#delete-account").addEventListener("click", async () => {
  if (!confirm("Delete your mix n match account and all its data? This cannot be undone.")) return;
  await api("/api/me", { method: "DELETE" });
  location.href = "/";
});

showFlash();
render().catch((err) => toast(err.message));

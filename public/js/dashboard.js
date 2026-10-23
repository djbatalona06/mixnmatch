// Dashboard: connected services, recent transfers, delete account.
import { api } from "./api.js";
import { $, el, formatDate, loadUser, platformDot, platformName, plural, toast } from "./ui.js";

const STATUS_PILL = {
  QUEUED: ["warn", "Starting"],
  RUNNING: ["warn", "Moving"],
  WAITING: ["warn", "Paused"],
  DONE: ["ok", "Done"],
  FAILED: ["bad", "Failed"],
  CANCELLED: ["", "Stopped"],
};
const SYNC_PILL = {
  ACTIVE: ["ok", "On"],
  PAUSED: ["", "Paused"],
  NEEDS_USER: ["bad", "Needs you"],
};

const ERRORS = {
  denied: "You cancelled the connection, so nothing was changed.",
  expired: "That took too long. Please try connecting again.",
  failed: "We couldn't finish connecting. Please try again.",
};

function showFlash() {
  const params = new URLSearchParams(location.search);
  const flash = $("#flash");
  if (params.get("premium") === "thanks") {
    flash.textContent = "Thank you! Premium is switched on as soon as the payment is confirmed (usually a few seconds).";
    flash.className = "notice ok";
  } else if (params.get("connected")) {
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

// ---------- Syncs (v1.2) ----------

function lastRun(sync) {
  if (sync.message) return sync.message;
  if (!sync.last_run_at) return `First check ${formatDate(sync.next_run_at)}`;
  const added = sync.last_added ? `added ${plural(sync.last_added, "song")}` : "nothing new";
  return `${formatDate(sync.last_run_at)} — ${added}`;
}

async function renderSyncs() {
  const { syncs, limit } = await api("/api/syncs");
  if (!syncs.length) return $("#syncs").replaceChildren(el("p", { class: "muted" }, `No syncs yet. You can keep ${plural(limit, "playlist")} in sync.`));
  $("#syncs").replaceChildren(
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", {}, "Playlist"), el("th", {}, "From → To"), el("th", {}, "Last run"), el("th", {}, "Status"), el("th", {}, ""))),
        el(
          "tbody",
          {},
          syncs.map((sync) => {
            const [tone, label] = SYNC_PILL[sync.status] ?? ["", sync.status];
            const paused = sync.status === "PAUSED";
            return el(
              "tr",
              {},
              el("td", {}, sync.last_job_id ? el("a", { href: `/results?job=${sync.last_job_id}` }, sync.name) : sync.name),
              el("td", {}, `${platformName(sync.source)} → ${platformName(sync.dest)}`),
              el("td", { class: "small" }, lastRun(sync)),
              el("td", {}, el("span", { class: `pill ${tone}` }, label)),
              el(
                "td",
                {},
                el(
                  "div",
                  { class: "row" },
                  el("button", { class: "btn btn-small", type: "button", onclick: () => setSync(sync, paused ? "ACTIVE" : "PAUSED") }, paused ? "Resume" : "Pause"),
                  el("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => removeSync(sync) }, "Delete"),
                ),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

async function setSync(sync, status) {
  try {
    await api(`/api/syncs/${sync.id}`, { method: "PATCH", body: { status } });
    await renderSyncs();
  } catch (err) {
    toast(err.message);
  }
}

async function removeSync(sync) {
  if (!confirm(`Stop keeping “${sync.name}” in sync? The copied playlist stays where it is.`)) return;
  await api(`/api/syncs/${sync.id}`, { method: "DELETE" });
  toast("Sync deleted");
  await renderSyncs();
}

// ---------- Premium (v1.2) ----------

function renderPlan(me) {
  $("#plan-section").classList.toggle("hidden", !me.billing);
  if (!me.billing) return;
  const premium = me.plan === "premium";
  const go = async (path, body) => {
    try {
      const { url } = await api(path, { method: "POST", body });
      location.href = url;
    } catch (err) {
      toast(err.message);
    }
  };
  $("#plan").replaceChildren(
    el("div", { class: "row space" }, el("strong", {}, premium ? "Premium" : "Free"), el("span", { class: `pill ${premium ? "ok" : ""}` }, premium ? "Active" : "Free plan")),
    el(
      "ul",
      {},
      el("li", {}, `${plural(me.limits.syncs, "playlist")} kept in sync`),
      el("li", {}, `${plural(me.limits.activeTransfers, "transfer")} at the same time`),
      el("li", {}, `Up to ${me.limits.fileTracks.toLocaleString()} songs per uploaded file`),
    ),
    premium
      ? el(
          "div",
          { class: "row" },
          el("span", { class: "muted small" }, `Paid until ${formatDate(me.planUntil)}.`),
          el("button", { class: "btn btn-small", type: "button", onclick: () => go("/api/billing/portal") }, "Manage or cancel"),
        )
      : el(
          "div",
          { class: "row" },
          el("button", { class: "btn btn-primary", type: "button", onclick: () => go("/api/billing/checkout", { plan: "monthly" }) }, "Get Premium (monthly)"),
          me.billing.yearly
            ? el("button", { class: "btn", type: "button", onclick: () => go("/api/billing/checkout", { plan: "yearly" }) }, "Get Premium (yearly)")
            : null,
          el("span", { class: "muted small" }, "Payment is handled by Stripe. mix n match never sees your card."),
        ),
  );
}

async function render() {
  const me = await loadUser();
  const byPlatform = Object.fromEntries(me.connections.map((c) => [c.platform, c]));
  $("#services").replaceChildren(...me.platforms.map((p) => serviceCard(p, byPlatform[p.id])));
  const canTransfer = me.connections.length > 0;
  $("#start-transfer").classList.toggle("hidden", !canTransfer);
  renderPlan(me);
  await Promise.all([renderJobs(), renderSyncs()]);
}

$("#delete-account").addEventListener("click", async () => {
  if (!confirm("Delete your mix n match account and all its data? This cannot be undone.")) return;
  await api("/api/me", { method: "DELETE" });
  location.href = "/";
});

showFlash();
render().catch((err) => toast(err.message));

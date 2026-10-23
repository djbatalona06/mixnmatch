// Sign-in page: request a magic link, or finish signing in with one.
import { api } from "./api.js";
import { $, el } from "./ui.js";

const token = new URLSearchParams(location.search).get("token");

function showError(message) {
  $("#error").textContent = message;
  $("#error").classList.remove("hidden");
}

if (token) {
  $("#ask").classList.add("hidden");
  $("#confirm").classList.remove("hidden");
  $("#confirm-btn").addEventListener("click", async () => {
    $("#confirm-btn").disabled = true;
    try {
      await api("/api/auth/verify", { method: "POST", body: { token } });
      location.replace("/dashboard");
    } catch (err) {
      showError(err.message);
      $("#confirm").classList.add("hidden");
      $("#ask").classList.remove("hidden");
      history.replaceState(null, "", "/login");
    }
  });
} else {
  // Already signed in? Go straight to the dashboard.
  fetch("/api/me", { headers: { "X-Requested-With": "mixnmatch" } }).then((r) => {
    if (r.ok) location.replace("/dashboard");
  });
}

$("#email-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#error").classList.add("hidden");
  const button = $("#send");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const email = $("#email").value;
    const result = await api("/api/auth/request", { method: "POST", body: { email } });
    $("#sent").textContent = `Check your inbox at ${email}. The link works once and expires in 15 minutes.`;
    $("#sent").classList.remove("hidden");
    if (result.devLink) {
      // Only happens when the server runs in DEV_MODE (local testing).
      $("#dev-link").replaceChildren("Dev mode: no email is sent. ", el("a", { href: result.devLink, id: "dev-link-a" }, "Open your sign-in link"));
      $("#dev-link").classList.remove("hidden");
    }
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Email me a link";
  }
});

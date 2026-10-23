// Shared page helpers: building elements safely, the header, toasts.
import { api } from "./api.js";

// Colours come from the .c-<id> classes in styles.css.
export const PLATFORM_INFO = {
  spotify: { name: "Spotify" },
  tidal: { name: "TIDAL" },
  deezer: { name: "Deezer" },
  youtube: { name: "YouTube Music" },
  mock: { name: "Demo Music" },
  file: { name: "File upload" },
};

export function platformName(id) {
  return PLATFORM_INFO[id]?.name ?? id;
}

/**
 * el("p", { class: "muted" }, "Hello")  ->  <p class="muted">Hello</p>
 * Text is always inserted as text (never as HTML), so names from music services are safe.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function $(selector) {
  return document.querySelector(selector);
}

export function platformDot(id) {
  return el("span", { class: `platform-dot c-${id}` });
}

let toastTimer;
export function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = el("div", { class: "toast", role: "status" }, message);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 4000);
}

/** Shows the signed-in email + sign-out button in the header. Returns the /api/me data. */
export async function loadUser() {
  const me = await api("/api/me");
  const nav = $(".nav");
  if (nav) {
    nav.replaceChildren(
      el("a", { href: "/dashboard" }, "Dashboard"),
      el("span", { class: "who", title: me.email }, me.email),
      el("button", { class: "btn btn-small btn-ghost", onclick: signOut }, "Sign out"),
    );
  }
  return me;
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/";
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Saves text as a file on the user's computer. */
export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

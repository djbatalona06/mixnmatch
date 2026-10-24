// "Add to Home Screen". Chrome/Edge/Android fire `beforeinstallprompt`; we keep it so the
// Install button can open the browser's own install window later. iPhone Safari has no such
// event, so there we show the Share -> Add to Home Screen steps instead.
import { create } from "zustand";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  prompt: InstallEvent | null;
  installed: boolean;
  install: () => Promise<void>;
}

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const useInstall = create<InstallState>((set, get) => ({
  prompt: null,
  installed: standalone(),
  install: async () => {
    const event = get().prompt;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    set({ prompt: null, installed: outcome === "accepted" });
  },
}));

// Listen right away: the event can fire before the first screen is drawn.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  useInstall.setState({ prompt: event as InstallEvent });
});
window.addEventListener("appinstalled", () => useInstall.setState({ prompt: null, installed: true }));

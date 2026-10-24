// Who is signed in. Loaded once by the signed-in layout, refreshed after changes.
import { create } from "zustand";
import { api } from "../lib/api";
import type { Me } from "../lib/types";

interface SessionState {
  me: Me | null;
  error: string | null;
  load: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  me: null,
  error: null,
  load: async () => {
    try {
      const me = await api<Me>("/api/me");
      set({ me, error: null });
      return me;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },
  signOut: async () => {
    await api("/api/auth/logout", { method: "POST" });
    set({ me: null });
    location.href = "/";
  },
}));

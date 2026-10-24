// One short message at the bottom of the screen, gone after 4 seconds.
import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (message: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), 4000);
  },
}));

/** toast("Saved") from anywhere, even outside React. */
export const toast = (message: string) => useToast.getState().show(message);

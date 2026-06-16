import { create } from "zustand";

/**
 * Tiny toast queue for premium, non-blocking feedback — confirmations (Saved,
 * Exported), gentle notices, and errors — instead of silent actions or a jarring
 * native `alert()`. Auto-dismisses; errors linger a little longer.
 */
export type ToastKind = "success" | "info" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    const ms = kind === "error" ? 6000 : 3200;
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Fire a toast from anywhere (components or plain functions). */
export const toast = (message: string, kind?: ToastKind) =>
  useToastStore.getState().push(message, kind);

import { useEffect, useRef } from "react";

/** Call `onClose` when the Escape key is pressed — lets keyboard users dismiss
 *  a dialog without reaching for the mouse. */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

/**
 * Focus management for a modal dialog: move focus into the dialog when it opens
 * (the first form control, or the dialog itself) and restore it to whatever was
 * focused before when it closes — so keyboard and screen-reader users aren't
 * stranded behind the modal. Returns a ref to attach to the dialog container.
 */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>(
      'input:not([disabled]),button:not([disabled]),select,textarea,[tabindex="0"]',
    );
    (focusable ?? node)?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);
  return ref;
}

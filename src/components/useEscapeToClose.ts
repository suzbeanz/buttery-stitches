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
    const selector =
      'input:not([disabled]),button:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
    const firstFocusable = node?.querySelector<HTMLElement>(selector);
    (firstFocusable ?? node)?.focus();

    // Trap Tab within the dialog so focus can't wander to the page behind the
    // modal (aria-modal alone doesn't stop the Tab key).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, []);
  return ref;
}

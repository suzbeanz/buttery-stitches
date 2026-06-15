import { useEffect } from "react";

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

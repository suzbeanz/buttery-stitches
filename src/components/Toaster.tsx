import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../store/toastStore";

const ICON: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  error: AlertTriangle,
};
const ICON_COLOR: Record<ToastKind, string> = {
  success: "text-ink-deep",
  info: "text-ink",
  error: "text-stamp",
};

/** Stack of auto-dismissing toasts (above the grain overlay). */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    // Below lg toasts drop in from the TOP, just under the top bar: a phone's
    // bottom half is where every working control lives (tool strip, simulator,
    // review bar, selection bar), and bottom toasts stacked right on top of
    // them — the review bar vanished under two toasts on a Pixel. Up top they
    // only ever cover canvas. At lg+ they hug the bottom edge as before.
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-4 lg:top-auto">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            // Errors interrupt (assertive); successes/info wait their turn.
            role={t.kind === "error" ? "alert" : "status"}
            aria-live={t.kind === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className="anim-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-sm border-2 border-ink bg-cream px-3 py-2 text-sm text-char shadow-press"
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${ICON_COLOR[t.kind]}`} aria-hidden />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded p-0.5 text-char/45 hover:text-char"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Keyboard-shortcut cheat sheet, toggled with `?`. */
import { useDialogFocus, useEscapeToClose } from "./useEscapeToClose";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Tools",
    keys: [
      ["V", "Select"],
      ["N", "Points"],
      ["H", "Hand (pan)"],
      ["M", "Measure"],
      ["R", "Running"],
      ["S", "Satin"],
      ["F", "Fill"],
      ["B", "Pencil"],
    ],
  },
  {
    title: "Drawing",
    keys: [
      ["Enter", "Finish shape"],
      ["Esc", "Cancel shape"],
      ["Del", "Delete selection"],
    ],
  },
  {
    title: "Document",
    keys: [
      ["⌘/Ctrl Z", "Undo"],
      ["⌘/Ctrl ⇧ Z", "Redo"],
      ["⌘/Ctrl S", "Save .embproj"],
    ],
  },
  {
    title: "Preview",
    keys: [
      ["P", "Toggle stitch view"],
      ["Space", "Play / pause"],
      ["?", "This help"],
    ],
  },
];

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  useEscapeToClose(onClose);
  return (
    // Click-outside closes; keyboard users dismiss with Escape (above).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="anim-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Keyboard shortcuts"
        className="anim-press-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-5 shadow-press outline-none"
      >
        <h2 className="mb-4 font-label uppercase tracking-[0.08em] text-lg font-semibold text-navy">
          🧈 Keyboard shortcuts
        </h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy/70">
                {g.title}
              </div>
              <ul className="flex flex-col gap-1">
                {g.keys.map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between text-sm">
                    <span className="text-navy/80">{label}</span>
                    <kbd className="rounded border border-navy/20 bg-butter-100 px-1.5 py-0.5 text-[11px] text-navy">
                      {k}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 text-right">
          <button
            onClick={onClose}
            className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keyboard-shortcut cheat sheet, toggled with `?`. */

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Tools",
    keys: [
      ["V", "Select"],
      ["N", "Node edit"],
      ["R", "Running"],
      ["S", "Satin"],
      ["F", "Fill"],
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-navy/20 bg-cream p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-butter text-lg font-semibold text-navy">
          🧈 Keyboard shortcuts
        </h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy/50">
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
            className="rounded bg-navy px-3 py-1.5 text-sm text-butter-200 hover:bg-navy-light"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

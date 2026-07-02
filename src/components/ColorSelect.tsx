import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ThreadColor } from "../types/project";

/** An optional non-color choice in the list (e.g. "New color…"). */
export interface ColorSelectExtra {
  value: string;
  label: string;
}

/** One row in the flattened option list (colors first, then extras). */
interface Opt {
  id: string;
  label: string;
  rgb?: [number, number, number];
}

/**
 * Branded color picker: a button showing the current swatch + name that opens a
 * popover of swatch+name rows — so you can actually SEE the colors (the native
 * <select> only showed names).
 *
 * Implements the full listbox keyboard model its ARIA roles announce: the
 * options themselves are focusable (roving tabindex), ArrowUp/Down move,
 * Home/End jump, type-ahead seeks by first letters, Enter/Space picks,
 * Esc/click-outside closes, and focus returns to the trigger on close.
 */
export default function ColorSelect({
  value,
  colors,
  onChange,
  extra = [],
  label = "Color",
}: {
  value: string;
  colors: ThreadColor[];
  onChange: (id: string) => void;
  extra?: ColorSelectExtra[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const typeahead = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });

  const opts: Opt[] = [
    ...colors.map((c) => ({ id: c.id, label: c.name ?? `rgb(${c.rgb.join(",")})`, rgb: c.rgb })),
    ...extra.map((x) => ({ id: x.value, label: x.label })),
  ];
  const selectedIdx = Math.max(0, opts.findIndex((o) => o.id === value));

  const cur = colors.find((c) => c.id === value);
  const curLabel = opts.find((o) => o.id === value)?.label ?? "Select…";

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (id: string) => {
    onChange(id);
    close(true);
  };

  // Focus the active option whenever the list is open (roving focus).
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus();
  }, [open, active]);

  const openList = () => {
    setActive(selectedIdx);
    setOpen(true);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(opts.length - 1, to)));
    };
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(opts.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = opts[active];
      if (o) pick(o.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false); // let focus move on naturally
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: accumulate letters typed within a second, seek the next
      // option whose label starts with the buffer (wrapping past the end).
      const now = Date.now();
      const t = typeahead.current;
      t.buf = (now - t.at < 1000 ? t.buf : "") + e.key.toLowerCase();
      t.at = now;
      const from = t.buf.length === 1 ? active + 1 : active;
      for (let k = 0; k < opts.length; k++) {
        const i = (from + k) % opts.length;
        if (opts[i].label.toLowerCase().startsWith(t.buf)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${curLabel}`}
        className="input flex w-full items-center gap-2 text-left"
      >
        {cur && (
          <span
            className="h-4 w-4 shrink-0 rounded-sm border border-navy/30"
            style={{ backgroundColor: `rgb(${cur.rgb.join(",")})` }}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{curLabel}</span>
        <ChevronDown size={14} className="shrink-0 text-ink/50" aria-hidden />
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => close(false)} />
          <ul
            role="listbox"
            aria-label={label}
            className="anim-press-in absolute inset-x-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-sm border-2 border-ink bg-cream p-1 shadow-press"
          >
            {opts.map((o, i) => {
              const sel = o.id === value;
              return (
                <li
                  key={o.id}
                  id={`colorselect-opt-${o.id}`}
                  role="option"
                  aria-selected={sel}
                  tabIndex={i === active ? 0 : -1}
                  ref={(n) => {
                    optionRefs.current[i] = n;
                  }}
                  onClick={() => pick(o.id)}
                  onKeyDown={onListKey}
                  onMouseMove={() => i !== active && setActive(i)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-navy ${
                    sel ? "bg-butter-200 text-navy" : "text-navy hover:bg-butter-200/60"
                  }`}
                >
                  {o.rgb ? (
                    <span
                      className="h-4 w-4 shrink-0 rounded-sm border border-navy/30"
                      style={{ backgroundColor: `rgb(${o.rgb.join(",")})` }}
                    />
                  ) : (
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-dashed border-navy/40 text-[11px] leading-none">
                      +
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

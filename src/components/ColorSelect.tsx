import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ThreadColor } from "../types/project";

/** An optional non-color choice in the list (e.g. "New color…"). */
export interface ColorSelectExtra {
  value: string;
  label: string;
}

/**
 * Branded color picker: a button showing the current swatch + name that opens a
 * popover of swatch+name rows — so you can actually SEE the colors (the native
 * <select> only showed names). Click-outside or Esc closes.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cur = colors.find((c) => c.id === value);
  const curExtra = extra.find((x) => x.value === value);
  const curLabel = cur
    ? (cur.name ?? `rgb(${cur.rgb.join(",")})`)
    : (curExtra?.label ?? "Select…");

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            aria-label={label}
            className="anim-press-in absolute inset-x-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-sm border-2 border-ink bg-cream p-1 shadow-press"
          >
            {colors.map((c) => {
              const name = c.name ?? `rgb(${c.rgb.join(",")})`;
              const sel = c.id === value;
              return (
                <li key={c.id} role="option" aria-selected={sel}>
                  <button
                    type="button"
                    onClick={() => pick(c.id)}
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                      sel ? "bg-butter-200 text-navy" : "text-navy hover:bg-butter-200/60"
                    }`}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-sm border border-navy/30"
                      style={{ backgroundColor: `rgb(${c.rgb.join(",")})` }}
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </button>
                </li>
              );
            })}
            {extra.map((x) => (
              <li key={x.value} role="option" aria-selected={x.value === value}>
                <button
                  type="button"
                  onClick={() => pick(x.value)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-navy hover:bg-butter-200/60"
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-dashed border-navy/40 text-[11px] leading-none">
                    +
                  </span>
                  <span className="min-w-0 flex-1 truncate">{x.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

# Runs inside Pyodide. Builds a pyembroidery EmbPattern from a plain "stitch
# plan" handed over from TypeScript and writes the requested format to bytes.
#
# The plan is JSON, already in pyembroidery's 1/10 mm units (the mm→tenths
# conversion happens on the TS side). One block per thread color:
#
#   {
#     "blocks": [
#       {
#         "rgb": 0xRRGGBB,
#         "cmds": [["s", x, y], ["j", x, y], ["t"], ...]   # stitch / jump / trim
#       },
#       ...
#     ]
#   }
#
# Between blocks we TRIM + COLOR_CHANGE, and END at the finish. This layer is
# deliberately dumb — it just emits what the (tested) TypeScript stitch engine
# computed.

import io
import json
import pyembroidery as pe

_WRITERS = {
    "pes": pe.write_pes,
    "dst": pe.write_dst,
    "jef": pe.write_jef,
    "exp": pe.write_exp,
    "vp3": pe.write_vp3,
    "tbf": pe.write_tbf,  # Barudan (carries colors; thread change = NEEDLE_SET)
}

_READERS = {
    "pes": pe.read_pes,
    "dst": pe.read_dst,
    "jef": pe.read_jef,
    "exp": pe.read_exp,
    "vp3": pe.read_vp3,
    "tbf": pe.read_tbf,
}


def _thread_rgb(thread):
    """0xRRGGBB for a pyembroidery thread, however it stores color."""
    try:
        return (thread.get_red() << 16) | (thread.get_green() << 8) | thread.get_blue()
    except Exception:
        try:
            return int(thread.color) & 0xFFFFFF
        except Exception:
            return 0


def import_design(data, fmt):
    """Read an embroidery file's bytes into a plain dict of color blocks, each a
    list of contiguous stitch RUNS (split at jumps / trims / color changes), in
    pyembroidery's 1/10 mm units. Mirrors the export plan shape so the TS side can
    rebuild objects. Returns a JSON string."""
    fmt = fmt.lower()
    reader = _READERS.get(fmt)
    if reader is None:
        raise ValueError("Unsupported format: %s" % fmt)

    pattern = reader(io.BytesIO(bytes(data)))

    # A real design tops out around ~100k stitches; a malformed/crafted file can
    # decode to millions and exhaust the WASM heap while we build runs + JSON.
    # Fail loud and friendly instead.
    MAX_STITCHES = 500_000
    if len(pattern.stitches) > MAX_STITCHES:
        raise ValueError(
            "This file decodes to %d stitches (limit %d) - it may be corrupt."
            % (len(pattern.stitches), MAX_STITCHES)
        )

    threads = [_thread_rgb(t) for t in pattern.threadlist]

    blocks = []
    color_idx = 0
    cur = {"rgb": threads[0] if threads else 0, "runs": []}
    run = []

    def flush():
        if len(run) >= 2:
            cur["runs"].append(run[:])
        run.clear()

    for x, y, cmd in pattern.stitches:
        c = cmd & 0xFF
        if c == pe.STITCH or c == pe.SEW_TO or c == pe.NEEDLE_AT:
            run.append([x, y])
        elif c == pe.COLOR_CHANGE or c == pe.NEEDLE_SET:
            # Some formats (TBF/U01) open with a NEEDLE_SET that *selects* the
            # first thread rather than changing away from it. Advancing here
            # would shift every block one color over — skip while empty.
            if not cur["runs"] and len(run) < 2:
                continue
            flush()
            blocks.append(cur)
            color_idx += 1
            rgb = threads[color_idx] if color_idx < len(threads) else 0
            cur = {"rgb": rgb, "runs": []}
        else:
            # JUMP, TRIM, STOP, END, … all break the current contiguous run.
            flush()

    flush()
    blocks.append(cur)
    blocks = [b for b in blocks if b["runs"]]
    return json.dumps({"blocks": blocks})


def build_pattern(plan):
    pattern = pe.EmbPattern()
    blocks = plan.get("blocks", [])
    for i, block in enumerate(blocks):
        if i > 0:
            pattern.add_command(pe.TRIM)
            pattern.add_command(pe.COLOR_CHANGE)
        pattern.add_thread({"rgb": int(block.get("rgb", 0))})
        for cmd in block.get("cmds", []):
            kind = cmd[0]
            if kind == "s":
                pattern.add_stitch_absolute(pe.STITCH, int(cmd[1]), int(cmd[2]))
            elif kind == "j":
                pattern.add_stitch_absolute(pe.JUMP, int(cmd[1]), int(cmd[2]))
            elif kind == "t":
                pattern.add_command(pe.TRIM)
            elif kind == "stop":
                # Machine STOP — pause for the operator (appliqué: lay/trim fabric).
                pattern.add_command(pe.STOP)
    pattern.add_command(pe.END)
    return pattern


def export_bytes(plan_json, fmt, pes_version=1):
    """Return the embroidery file as a Python `bytes` object."""
    fmt = fmt.lower()
    writer = _WRITERS.get(fmt)
    if writer is None:
        raise ValueError("Unsupported format: %s" % fmt)

    pattern = build_pattern(json.loads(plan_json))

    buf = io.BytesIO()
    if fmt == "pes":
        writer(pattern, buf, {"version": int(pes_version)})
    else:
        writer(pattern, buf)
    return buf.getvalue()

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
}


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

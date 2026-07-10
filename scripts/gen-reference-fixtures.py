#!/usr/bin/env python3
"""Generate third-party reference fixtures with CPython pyembroidery.

pyembroidery (MIT) is the reference implementation the native TS writers were
modeled on. These fixtures are INDEPENDENT of the app's own encoders, so tests
against them catch bugs a self-referential encode->decode round trip cannot
(the audit's top testing gap). Regenerate with:

    pip install public/wheels/pyembroidery-1.5.1-py2.py3-none-any.whl
    python3 scripts/gen-reference-fixtures.py

Writes into src/lib/export/native/__fixtures__/:
    reference-plan.json   the canonical plan (1/10 mm), same shape as StitchPlan
    reference.dst         pyembroidery's write_dst of that plan
    reference-v1.pes      pyembroidery's write_pes (version 1) of that plan
    reference-decoded.json  the stitch stream pyembroidery reads back from its
                            own DST file (command, x, y triples)
"""
import io
import json
import os

import pyembroidery as pe

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "export", "native", "__fixtures__")
os.makedirs(OUT, exist_ok=True)

# Canonical two-color plan in 1/10 mm. Deliberately covers: multi-stitch runs,
# a jump inside a block, a mid-block trim, negative-direction moves, and a
# color change. Coordinates stay small so every delta fits one DST record.
PLAN = {
    "blocks": [
        {
            "rgb": 0xC41E3A,  # red
            "cmds": [
                ["s", 0, 0], ["s", 30, 0], ["s", 60, 0], ["s", 60, 30],
                ["s", 30, 30], ["s", 0, 30],
                ["j", 100, 30],
                ["s", 100, 30], ["s", 130, 30], ["s", 130, 60],
                ["t"],
                ["s", 0, 60], ["s", 30, 60], ["s", 30, 90],
            ],
        },
        {
            "rgb": 0x2454B0,  # blue
            "cmds": [
                ["s", 30, 90], ["s", 60, 90], ["s", 60, 120], ["s", 90, 120],
                ["s", 90, 90], ["s", 120, 90],
            ],
        },
    ]
}


def build(plan):
    p = pe.EmbPattern()
    for i, b in enumerate(plan["blocks"]):
        if i > 0:
            p.add_command(pe.TRIM)
            p.add_command(pe.COLOR_CHANGE)
        p.add_thread({"rgb": int(b["rgb"])})
        for c in b["cmds"]:
            k = c[0]
            if k == "s":
                p.add_stitch_absolute(pe.STITCH, int(c[1]), int(c[2]))
            elif k == "j":
                p.add_stitch_absolute(pe.JUMP, int(c[1]), int(c[2]))
            elif k == "t":
                p.add_command(pe.TRIM)
            elif k == "stop":
                p.add_command(pe.STOP)
    p.add_command(pe.END)
    return p


pattern = build(PLAN)

with open(os.path.join(OUT, "reference-plan.json"), "w") as f:
    json.dump(PLAN, f, indent=2)

dst = io.BytesIO()
pe.write_dst(pattern, dst)
with open(os.path.join(OUT, "reference.dst"), "wb") as f:
    f.write(dst.getvalue())

pes = io.BytesIO()
pe.write_pes(pattern, pes, {"pes version": 1})
with open(os.path.join(OUT, "reference-v1.pes"), "wb") as f:
    f.write(pes.getvalue())

# Read pyembroidery's own DST back with its reader: the authoritative record of
# what a machine-side reader sees (STITCH/JUMP penetrations after decoding).
readback = pe.read_dst(io.BytesIO(dst.getvalue()))
decoded = [[cmd & pe.COMMAND_MASK, x, y] for (x, y, cmd) in readback.stitches]
with open(os.path.join(OUT, "reference-decoded.json"), "w") as f:
    json.dump(
        {
            "constants": {"STITCH": pe.STITCH, "JUMP": pe.JUMP, "TRIM": pe.TRIM,
                          "COLOR_CHANGE": pe.COLOR_CHANGE, "END": pe.END},
            "stitches": decoded,
        },
        f,
    )

print("fixtures written to", os.path.abspath(OUT))
for name in sorted(os.listdir(OUT)):
    print(" ", name, os.path.getsize(os.path.join(OUT, name)), "bytes")

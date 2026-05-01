#!/usr/bin/env python3
"""CADGate sidecar: exec a CadQuery script and export the result to STL.

Usage:  worker.py <script_path> <stl_out_path>
Exit codes:
  0 ok
  2 syntax error in user script
  3 runtime error in user script
  4 no result Workplane found in user script

stdout: a single JSON line with run metadata.
stderr: human-readable error messages on non-zero exit.
"""
import json
import sys
import traceback
from pathlib import Path


def _pick_result(ns: dict):
    if "result" in ns:
        return ns["result"]
    if "show_object_result" in ns:
        return ns["show_object_result"]
    import cadquery as cq
    for value in reversed(list(ns.values())):
        if isinstance(value, (cq.Workplane, cq.Assembly, cq.Shape)):
            return value
    return None


def main(script: str, out: str) -> int:
    code = Path(script).read_text()
    namespace: dict = {"__name__": "__cadgate__"}

    try:
        compiled = compile(code, script, "exec")
    except SyntaxError as exc:
        print(f"SyntaxError: {exc}", file=sys.stderr)
        return 2

    try:
        exec(compiled, namespace)
    except Exception:
        traceback.print_exc()
        return 3

    result = _pick_result(namespace)
    if result is None:
        print("CADGate: no `result` Workplane / Assembly / Shape found in script", file=sys.stderr)
        return 4

    try:
        import cadquery as cq
        cq.exporters.export(
            result,
            out,
            exportType="STL",
            tolerance=0.1,
            angularTolerance=0.1,
        )
    except Exception:
        traceback.print_exc()
        return 3

    print(json.dumps({"stl": out, "tolerance": 0.1, "angularTolerance": 0.1, "units": "mm"}))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: worker.py <script_path> <stl_out_path>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))

#!/usr/bin/env python3
"""CADGate sidecar: exec a CadQuery or Build123d script and export the result to STL.

Usage:  worker.py <script_path> <stl_out_path>
Exit codes:
  0 ok
  2 syntax error in user script
  3 runtime error in user script
  4 no result object found in user script

stdout: a single JSON line with run metadata (including detected library).
stderr: human-readable error messages on non-zero exit.
"""
import ast
import json
import sys
import traceback
from pathlib import Path


def detect_library(source: str) -> str | None:
    """Inspect top-level imports to decide which CAD library to dispatch to."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root == "cadquery":
                    return "cadquery"
                if root == "build123d":
                    return "build123d"
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root == "cadquery":
                return "cadquery"
            if root == "build123d":
                return "build123d"
    return None


def _pick_cadquery_result(ns: dict, shown: list):
    if "result" in ns:
        return ns["result"]
    if shown:
        return shown[0]
    import cadquery as cq
    for value in reversed(list(ns.values())):
        if isinstance(value, (cq.Workplane, cq.Assembly, cq.Shape)):
            return value
    return None


def _pick_build123d_result(ns: dict, shown: list):
    if "result" in ns:
        return ns["result"]
    if shown:
        return shown[0]
    import build123d as bd
    candidates = (bd.Part, bd.Compound, bd.Solid, bd.Shape)
    for value in reversed(list(ns.values())):
        if isinstance(value, candidates):
            return value
    return None


def export_cadquery(result, out: str) -> None:
    import cadquery as cq
    cq.exporters.export(
        result, out, exportType="STL", tolerance=0.1, angularTolerance=0.1,
    )


def export_build123d(result, out: str) -> None:
    import build123d as bd
    bd.export_stl(result, out, tolerance=0.1, angular_tolerance=0.1)


DISPATCH = {
    "cadquery": (_pick_cadquery_result, export_cadquery),
    "build123d": (_pick_build123d_result, export_build123d),
}


def main(script: str, out: str) -> int:
    code = Path(script).read_text()
    library = detect_library(code) or "cadquery"  # back-compat default

    shown: list = []

    def show_object(obj, *_args, **_kwargs):
        shown.append(obj)

    namespace: dict = {
        "__name__": "__cadgate__",
        "show_object": show_object,
        "debug": show_object,
        "log": lambda *args, **kwargs: None,
    }

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

    pick, export = DISPATCH[library]
    result = pick(namespace, shown)
    if result is None:
        print(
            f"CADGate ({library}): no `result` variable, no show_object() call, "
            "and no top-level result object found in script.",
            file=sys.stderr,
        )
        return 4

    try:
        export(result, out)
    except Exception:
        traceback.print_exc()
        return 3

    print(json.dumps({
        "stl": out,
        "library": library,
        "tolerance": 0.1,
        "angularTolerance": 0.1,
        "units": "mm",
    }))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: worker.py <script_path> <stl_out_path>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))

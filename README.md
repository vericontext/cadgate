# CADGate

Validate AI-generated CAD-as-code PRs (CadQuery / Build123d / OpenSCAD / KCL) — geometric metric diff, DFM rules, and LLM judge as a CLI gate and MCP server.

> Status: Phase 0 (PoC) / Phase 1 (CLI MVP). See `/Users/kiyeonjeon/.claude/plans/typed-conjuring-goblet.md` for the implementation plan.

## Quickstart

```bash
bun install
bun run build:sidecar              # builds the Python CadQuery sidecar Docker image
bun run poc                        # runs the end-to-end PoC pipeline
```

## CLI (Phase 1)

```bash
bun run dev check --base main --head HEAD --report json
```

## Architecture

CADGate exposes one validation engine through two interfaces:

- `cadgate check` — CLI gate for CI (Phase 1)
- `cadgate mcp serve` — MCP server for agentic self-validation (Phase 4)

CAD code execution happens in a Python Docker sidecar (CadQuery is Python-only). Mesh analysis runs in TypeScript via `manifold-3d` (WASM).

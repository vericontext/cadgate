# CADGate

Validate AI-generated CAD-as-code PRs (CadQuery / Build123d) — geometric metric diff, DFM rules, 6-view PR previews, and (Phase 3) LLM judge as a CLI gate and MCP server.

> Status: Phase 2b. Active work and roadmap tracked in [issues](https://github.com/vericontext/cadgate/issues); see [CONTRIBUTING](./CONTRIBUTING.md) for the phase table.

## GitHub Action (Phase 2b)

Drop this in `.github/workflows/cadgate.yml` of your hardware repo:

```yaml
name: CADGate
on:
  pull_request:
    paths: ['**/*.py', '.cadgate/**']

jobs:
  validate:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: vericontext/cadgate@v0.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

A typical PR gets:
- ❌/✅ exit-coded CI gate (DFM rule violations → `RULE_VIOLATION` exit 5).
- 6-view rendered preview comment, sticky-updated on every push.

## Local quickstart

```bash
bun install
bun run build:sidecar      # builds both Python sidecar Docker images
bun run build              # produces dist/cadgate (compiled, self-contained)

# Inside any git repo with CadQuery / Build123d files:
./dist/cadgate check --base main --head HEAD
```

## Architecture

CADGate exposes one validation engine through two interfaces:

- `cadgate check` — CLI gate for CI (Phase 1+).
- `cadgate report post-pr` — sticky PR comment with 6-view renders + diff (Phase 2b).
- `cadgate mcp serve` — MCP server for agentic self-validation (Phase 4).

CAD code runs in a Python Docker sidecar (CadQuery / Build123d are Python-only on top of OpenCascade). Mesh analysis runs in TypeScript via `manifold-3d` (WASM); minimum wall thickness via `three-mesh-bvh`. Rendering uses `puppeteer-core` + system Chromium.

## Supported environments

- **Runtime:** Bun ≥1.1 (binary releases bundle the Bun runtime).
- **CAD execution:** Docker daemon, with `kiyeonj21/cadquery-sidecar:0.2` and/or `kiyeonj21/build123d-sidecar:0.2` images.
- **Rendering (optional):** Chromium 120+ (system-installed). Use `--render=false` to skip.
- **CI:** GitHub Actions `ubuntu-latest` runner has all of the above ready.

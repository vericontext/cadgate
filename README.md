# CADGate

Validate AI-generated CAD-as-code PRs (CadQuery / Build123d) — geometric metric diff, DFM rules, and 6-view rendered PR previews.

## GitHub Action

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
- ❌/✅ exit-coded CI gate (DFM rule violations → exit 5).
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

CADGate runs as a single compiled binary with two interface adapters:

- `cadgate check` — exit-code-driven CI gate. Reads git refs, runs CAD code in a sandboxed Docker sidecar, computes mesh metrics + DFM rule violations against a `.cadgate/rules.yaml` config.
- `cadgate report post-pr` — posts/updates a sticky PR comment with the 6-view renders + diff table + violation list.

CAD code runs in Python Docker sidecars (CadQuery / Build123d are Python-only on top of OpenCascade). Mesh analysis runs in TypeScript via `manifold-3d` (WASM); minimum wall thickness via `three-mesh-bvh`. Rendering uses `puppeteer-core` + system Chromium.

## Supported environments

- **Runtime:** Bun ≥1.1 (binary releases bundle the Bun runtime).
- **CAD execution:** Docker daemon, with `kiyeonj21/cadquery-sidecar:0.2` and/or `kiyeonj21/build123d-sidecar:0.2` images.
- **Rendering (optional):** Chromium 120+ (system-installed). Use `--render=false` to skip.
- **CI:** GitHub Actions `ubuntu-latest` runner has all of the above ready.

## Roadmap

- **LLM judge** — feed renders + metric diff + PR description to Claude Opus / GPT / Gemini for intent-vs-actual verdicts. Lets the comment cite *why* a change looks like a regression vs an intentional redesign.
- **`cadgate mcp serve`** — expose the same engine via Model Context Protocol so agentic CAD generators (Cursor, Claude Code, Zoo Zookeeper, etc.) can self-validate before opening PRs.
- **OpenSCAD + KCL drivers**.
- **Hosted playground** at cadgate.dev (paste two STL/source revisions, get a CADGate report instantly).
- **Public benchmark leaderboard** for AI-generated-CAD regressions across active OSS hardware repos.

See [CONTRIBUTING](./CONTRIBUTING.md) for development setup and the live status table.

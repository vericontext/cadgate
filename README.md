# CADGate

Validate AI-generated CAD-as-code PRs (CadQuery / Build123d) — geometric metric diff, DFM rules, and 6-view rendered PR previews.

## GitHub Action — for hardware repos (recommended)

Drop this in `.github/workflows/cadgate.yml` of your repo and CADGate runs on every PR. The Action downloads the binary itself; nothing to install on your machine.

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

## Install the CLI locally

If you want to run `cadgate` from your terminal — e.g. to validate a PR before pushing, or pipe `cadgate check` into a custom workflow — grab the prebuilt binary from the latest release.

```bash
# macOS, Apple Silicon
curl -fsSL https://github.com/vericontext/cadgate/releases/latest/download/cadgate-darwin-arm64 \
  -o /usr/local/bin/cadgate && chmod +x /usr/local/bin/cadgate

# Linux x64
curl -fsSL https://github.com/vericontext/cadgate/releases/latest/download/cadgate-linux-x64 \
  -o /usr/local/bin/cadgate && chmod +x /usr/local/bin/cadgate

# Linux arm64
curl -fsSL https://github.com/vericontext/cadgate/releases/latest/download/cadgate-linux-arm64 \
  -o /usr/local/bin/cadgate && chmod +x /usr/local/bin/cadgate

cadgate version
```

> **Intel Mac (`darwin-x64`)**: not shipped as a prebuilt binary in v0.1.x —
> GitHub's free `macos-13` runner queue is unpredictable. Build from source
> (see [Build from source](#build-from-source--contribute) below); `bun build --compile`
> produces a native `darwin-x64` binary in ~2 minutes.

The binary is self-contained (Bun runtime + JS deps inlined). You also need:

```bash
# Docker — for CAD execution
docker pull kiyeonj21/cadquery-sidecar:0.2
docker pull kiyeonj21/build123d-sidecar:0.2

# Chromium — for the 6-view renders (optional; skip with --render=false)
brew install chromium                          # macOS
sudo apt install chromium-browser              # Debian / Ubuntu
```

### CLI usage

Inside any git repo with CadQuery or Build123d files:

```bash
cadgate check --base main --head HEAD                                   # JSON to stdout if piped, text if TTY
cadgate check --base main --head HEAD --rules .cadgate/rules.yaml       # apply DFM rules
cadgate check --base main --head HEAD --render true --render-out ./out  # write 6-view PNGs to ./out
cadgate report post-pr --report report.json --pr 123                    # post sticky GitHub PR comment

cadgate check --help    # full option list
cadgate report --help   # full subcommand list
```

Exit codes: `0` ok · `2` invalid args · `3` Docker missing/unavailable · `4` driver run failed · `5` DFM rule violation.

## Architecture

CADGate runs as a single compiled binary with two interface adapters:

- `cadgate check` — exit-code-driven CI gate. Reads git refs, runs CAD code in a sandboxed Docker sidecar, computes mesh metrics + DFM rule violations against a `.cadgate/rules.yaml` config.
- `cadgate report post-pr` — posts/updates a sticky PR comment with the 6-view renders + diff table + violation list.

CAD code runs in Python Docker sidecars (CadQuery / Build123d are Python-only on top of OpenCascade). Mesh analysis runs in TypeScript via `manifold-3d` (WASM); minimum wall thickness via `three-mesh-bvh`. Rendering uses `puppeteer-core` + system Chromium.

## Supported environments

- **Runtime:** Bun ≥1.1 (the prebuilt binary bundles the runtime).
- **CAD execution:** Docker daemon, with `kiyeonj21/cadquery-sidecar:0.2` and/or `kiyeonj21/build123d-sidecar:0.2` images.
- **Rendering (optional):** Chromium 120+ (system-installed). Use `--render=false` to skip.
- **CI:** GitHub Actions `ubuntu-latest` runner has all of the above ready.

## Roadmap

- **LLM judge** — feed renders + metric diff + PR description to Claude Opus / GPT / Gemini for intent-vs-actual verdicts. Lets the comment cite *why* a change looks like a regression vs an intentional redesign.
- **`cadgate mcp serve`** — expose the same engine via Model Context Protocol so agentic CAD generators (Cursor, Claude Code, Zoo Zookeeper, etc.) can self-validate before opening PRs.
- **OpenSCAD + KCL drivers**.
- **Hosted playground** at cadgate.dev (paste two STL/source revisions, get a CADGate report instantly).
- **Public benchmark leaderboard** for AI-generated-CAD regressions across active OSS hardware repos.

## Build from source / contribute

```bash
git clone https://github.com/vericontext/cadgate
cd cadgate
bun install
bun run build:sidecar       # builds both sidecar Docker images
bun run build               # produces dist/cadgate
bun test
```

See [CONTRIBUTING](./CONTRIBUTING.md) for engine API discipline, the contribution flow, and the live status table.

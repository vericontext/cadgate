# CADGate

Validate AI-generated CAD-as-code PRs (CadQuery / Build123d) — geometric metric diff, DFM rules, 6-view rendered PR previews, and an LLM judge that compares head geometry against the human-authored PR description.

Pairs naturally with code-generation tools that emit parametric CAD as Python source — e.g. AI coding agents using [text-to-cad](https://github.com/earthtojake/text-to-cad), [cad-agent](https://github.com/Svetlana-DAO-LLC/cad-agent), or [CQAsk](https://github.com/OpenOrion/CQAsk). Those tools generate; CADGate is the review layer that catches what they miss before the PR merges.

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

## MCP server (for AI agents)

CADGate ships an MCP stdio server so agents can self-validate generated CAD code before committing — closing the agentic loop in seconds instead of waiting for a CI run.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cadgate": {
      "command": "/usr/local/bin/cadgate",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Cursor / Cline / Continue / Claude Code**: same `command` + `args` shape; check your client's MCP docs for the exact config file path.

### Tools

| Tool | Inputs | Returns |
|------|--------|---------|
| `cad_validate` | `source`, optional `language`, `rules`, `render` | metrics + (if rules) violations + (if render) 6 PNG paths |
| `cad_diff` | `baseSource`, `headSource`, optional `language` | base + head metrics + delta (volume, area, watertight, bbox, min-wall) |
| `cad_dfm_check` | `source`, `rules`, optional `language` | rule violations |
| `cad_render` | `source`, optional `language`, `views` (default all 6) | PNG paths on local disk |
| `cad_judge` | `headSource` + optional `baseSource`, `prDescription`, `rules`, `judge` (`opus`/`sonnet`) | structured verdict (`pass`/`block`/`comment-only`) + intent match + grounded reasons + the underlying metrics/delta/violations |

`language` is auto-detected from `import cadquery` / `import build123d` when omitted. Rendered PNGs persist for the MCP server's lifetime, then are cleaned up on shutdown — read them right after the call.

The MCP server reuses the same Docker sidecars and Chromium dependencies as `cadgate check`. To launch without the renderer: `cadgate mcp serve --no-render`. `cad_judge` requires `ANTHROPIC_API_KEY` at server start — pass it via the `env` block of your MCP client's config (Claude Desktop's per-server `env` is the cleanest path, since the MCP client's launch shell doesn't inherit your `~/.zshrc` exports), or via `--anthropic-api-key`. Without the key, the other 4 tools work normally and `cad_judge` returns `JUDGE_AUTH`.

## LLM judge (opt-in)

`cadgate check` can call an LLM to compare the head geometry against the human-authored PR description and return a structured verdict (`pass` / `block` / `comment-only`) grounded in the renders + metrics + DFM violations the engine already produced.

```bash
ANTHROPIC_API_KEY=sk-ant-… cadgate check \
  --base main --head HEAD \
  --judge opus \
  --pr-description-file pr-body.txt
```

The verdict appears as a typed `judge` field on each analyzed file in the JSON report and as a **Judge** section in the sticky PR comment (verdict badge, intent match, grounded reasons, plain-prose note). Default is `--judge=none` so production CI doesn't accrue Anthropic costs by accident.

| Flag | Purpose |
|------|---------|
| `--judge none\|opus\|sonnet` | Choose the model. `opus` → `claude-opus-4-7`, `sonnet` → `claude-sonnet-4-6`. |
| `--judge-model <id>` | Override the exact model id (e.g. `claude-opus-4-7-1m`). |
| `--pr-description "<text>"` | PR description text passed to the judge. |
| `--pr-description-file <path>` | Read the PR description from a file. CI flow: `gh pr view --json body -q .body > pr-body.txt`. |
| `--anthropic-api-key <key>` | Override the `ANTHROPIC_API_KEY` env. |

**Prompt caching is on by default.** The system prompt, tool schema, and the entire base side (source + metrics + 6 renders) are cached with `cache_control: ephemeral`. Successive pushes to the same PR re-use the cached prefix and pay only for the changed head side — typically a >5× cost drop after the first call within the cache TTL.

**Cost ballpark (Opus 4.7, 12-image cold call):** ~$0.30 cold, ~$0.05 warm. Treat as a reviewer-grade signal, not a per-commit linter.

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

- **OpenAI + Gemini judge drivers** — same `JudgeDriver` interface; swap in via `--judge=gpt5` / `--judge=gemini`.
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

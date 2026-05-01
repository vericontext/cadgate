# Contributing to CADGate

Thanks for considering a contribution. CADGate is a single-developer project right now, so the bar is "ship the validation gate that AI hardware repos need" — pragmatic over perfect.

## Local setup

```bash
bun install                 # deps
bun run build:sidecar       # build the two CAD Docker sidecars (cadquery + build123d)
bun run build               # bundle render page + compile dist/cadgate
bun run test                # full suite (skip Docker/Chromium tests via env vars)
bun run typecheck           # tsc --noEmit
```

Requires:
- Bun ≥ 1.1
- Docker (for the CAD sidecars)
- Chromium 120+ (for the renderer; `brew install chromium` or `apt install chromium-browser`)

To skip the heavy integration tests (Docker / Chromium):

```bash
CADGATE_SKIP_DOCKER=1 CADGATE_SKIP_CHROMIUM=1 bun test
```

## Project shape

```
src/
  cli/         # citty subcommands (check, report, version) + output / colors / logger
  core/        # engine: runner orchestrator, git helpers, diff math, types
  drivers/     # CAD execution: cadquery / build123d sharing one Docker driver
  metrics/     # manifold-3d wrapper, min-wall (three-mesh-bvh), DFM rule engine
  render/      # 6-view headless render (puppeteer-core + three.js)
  github/      # Octokit wrapper, sticky comments, orphan-branch image push
python-sidecar/    # one Dockerfile, two requirements.txt — built per CAD lib
tests/             # bun:test
```

## Engine API discipline

The `src/core/`, `src/drivers/`, `src/metrics/`, `src/render/`, and `src/github/` modules must stay free of CLI side effects:

- No `process.exit`, no `console.*` calls (use the typed `Logger` from `src/cli/logger.ts` only inside `src/cli/`).
- No reads of `process.argv`, `process.cwd`, or `Bun.env` for behavioral inputs (the CLI layer parses these and injects them as typed parameters).
- Errors are typed Results (`{ ok: false, error: { kind, message } }`) or domain-specific classes (`GitError`, `DriverReadyError`, `GithubError`) — never bare `throw` from public APIs of the engine.

Phase 4 will expose the engine through MCP, and the discipline above is what keeps that adapter at ~50 lines.

## Commits & PRs

- Commits are imperative present tense and lead with the area:  `core: …`, `cli: …`, `render: …`, etc. Phase milestones use `Phase 2a: …`-style headlines.
- One logical change per commit. Don't bundle refactors with feature additions.
- PRs need a passing `Test` workflow before merge. Self-validation via the CADGate Action lands once v0.1.0 is published.
- Co-author trailers welcome — the project uses Claude Opus regularly and credits it in commits.

## What's actively being built

Phase status:

| Phase | Status |
|-------|--------|
| 0–1: PoC + `cadgate check` CLI | ✅ shipped |
| 2a: Build123d driver, min-wall, DFM rule engine | ✅ shipped |
| 2b: 6-view rendering, PR comments, GitHub Action | 🎯 in progress |
| 3: LLM judge (Anthropic / OpenAI / Gemini) | 🔜 |
| 4: `cadgate mcp serve` + OpenSCAD/KCL drivers | 🔜 |
| 5: cadgate.dev playground + public benchmark | 🔜 |

Open issues map roughly to these phases. New rule ideas, new CAD-language drivers, and clean small bug fixes are all welcome.

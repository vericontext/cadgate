# CADGate MCP Demo

End-to-end verification of `cadgate mcp serve` from a real MCP client (Claude Desktop). Every prompt below is copy-pasteable — paste, run, check the expected output.

## Prerequisites

| | Required for |
|--|--|
| **Claude Desktop** (or Cursor / Cline / Continue — any MCP-stdio client) | All tools |
| **Docker Desktop, running** | `cad_validate`, `cad_diff`, `cad_dfm_check`, `cad_render`, `cad_judge` |
| `kiyeonj21/cadquery-sidecar:0.2` + `kiyeonj21/build123d-sidecar:0.2` images | All tools (`docker pull` if not local) |
| **Chromium 120+** (`brew install chromium` / `apt install chromium-browser`) | `cad_render`, `cad_judge` (vision input) |
| **Anthropic API key** (`ANTHROPIC_API_KEY`) | `cad_judge` only |

The binary itself is self-contained — Bun runtime + JS deps are bundled.

## Setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add a `mcpServers` entry. If the file already has other keys (`preferences`, etc.), keep them — only add `mcpServers`:

```json
{
  "mcpServers": {
    "cadgate": {
      "command": "/usr/local/bin/cadgate",
      "args": ["mcp", "serve"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

The `env` block is the recommended way to pass the Anthropic key — Claude Desktop launches `cadgate mcp serve` from its own shell, which doesn't inherit your `~/.zshrc` exports. Without the key, four tools work normally and `cad_judge` returns `JUDGE_AUTH`. Alternative: pass `--anthropic-api-key sk-ant-...` in `args` instead of using `env`.

If you haven't run the install `curl` from the [README](./README.md#install-the-cli-locally), point `command` at the source build instead:

```json
"command": "/absolute/path/to/cadgate/dist/cadgate"
```

Quit Claude Desktop completely (`Cmd+Q`, **not** just close the window) and reopen. In the connector list (`+ → Connectors`), `cadgate` should appear with a `LOCAL DEV` badge and five tools listed under **Tool access** → **Other tools**: `cad_validate`, `cad_diff`, `cad_dfm_check`, `cad_render`, `cad_judge`.

## A note on Claude's lazy tool loading

Claude Desktop loads MCP tools on-demand based on prompt relevance. Your first prompt may have only a subset of the 5 tools in Claude's working set — if it tells you a tool isn't available, run this once to prime it:

```
List every MCP tool you can call from the cadgate connector. Print just the tool names.
```

After that, all five are accessible for the rest of the session.

## Tool 1: `cad_validate`

Prompt:

```
Use cadgate.cad_validate on this CadQuery code:

import cadquery as cq
result = cq.Workplane("XY").box(20, 20, 20)
```

Expected (typical first-call latency: 5–8 s for sidecar cold-start):

| Metric | Value |
|--------|-------|
| `volume` | 8000 mm³ |
| `surfaceArea` | 2400 mm² |
| `isWatertight` | `true` |
| `bbox` | `[-10,-10,-10]` to `[10,10,10]` |
| `triCount` | 12 |
| `minWallMm` | 20 |
| `minWallHotspots` | 5 entries, all 20 mm |

## Tool 2: `cad_diff`

Prompt:

```
Use cadgate.cad_diff to compare these two sources.

baseSource:
import cadquery as cq
result = cq.Workplane("XY").box(20, 20, 20)

headSource:
import cadquery as cq
result = cq.Workplane("XY").box(22, 22, 22)
```

Expected:

| Field | Value |
|-------|-------|
| `baseMetrics.volume` | 8000 |
| `headMetrics.volume` | 10648 |
| `delta.volumeDelta` | ≈ +2648 |
| `delta.volumeDeltaPct` | ≈ +33.1 |
| `delta.surfaceAreaDelta` | ≈ +504 |
| `delta.bboxChanged` | `true` |
| `delta.watertightnessChanged` | `false` |

## Tool 3: `cad_dfm_check`

A 0.5 mm shelled box must violate a 1.2 mm minimum-wall rule.

Prompt:

```
Use cadgate.cad_dfm_check on this CadQuery code with a 1.2mm minimum wall rule.

source:
import cadquery as cq
result = cq.Workplane("XY").box(20, 20, 20).faces(">Z").shell(-0.5)

rules:
{
  "version": 1,
  "rules": [
    {"id": "min-wall-thickness", "minMm": 1.2, "severity": "error"}
  ]
}
```

Expected:

| Field | Value |
|-------|-------|
| `violations.length` | 1 |
| `violations[0].ruleId` | `"min-wall-thickness"` |
| `violations[0].severity` | `"error"` |
| `violations[0].message` | mentions `0.50mm < 1.2mm` |

To smoke-test the no-violation path, swap the `source` for the original 20 mm cube — `violations` returns `[]`.

## Tool 4: `cad_render`

Requires Chromium installed locally.

Prompt:

```
Use cadgate.cad_render to produce all 6 views of this cube.

source:
import cadquery as cq
result = cq.Workplane("XY").box(20, 20, 20)
```

Expected (default — `inline: false`):

| Field | Value |
|-------|-------|
| `renders` | object with 6 keys: `front`, `back`, `top`, `bottom`, `left`, `right` |
| Each value | absolute PNG path under `/private/tmp/cadgate-mcp-…/call-…/renders/` (lives until MCP server shutdown) |
| Text content | also includes a `Preview locally:` hint with a single `open` command for the parent dir |

To preview the renders in macOS Preview, copy the `open` line from the response (e.g. `open /private/tmp/cadgate-mcp-…/renders/*.png`) into your terminal.

### Vision analysis (`inline: true`)

Default is `inline: false` because as of late 2026 most MCP chat clients — including Claude Desktop — pipe tool-returned image content into the model's vision context but **don't render the PNGs in the chat UI for the user**. Sending base64 every call would be a ~500 KB-1 MB tax for an embed nobody sees.

When you want the *model* to analyze the PNGs (e.g. "describe what's wrong with this geometry"), opt in:

```
Use cadgate.cad_render with inline: true, then describe what you see.

source:
import cadquery as cq
result = cq.Workplane("XY").box(20, 30, 10)
```

The model now sees the renders directly and can reason about them, even though the chat UI still won't surface the PNG to you. Combine with `open …/*.png` for the human view.

### When Chromium isn't installed

```json
{
  "ok": false,
  "error": {
    "code": "CHROMIUM_UNAVAILABLE",
    "message": "Renderer not initialized. Start cadgate without --no-render and ensure Chromium is installed."
  }
}
```

This is a valid result — the fallback fires correctly. Install Chromium and retry.

## Tool 5: `cad_judge`

Calls Claude Opus 4.7 (or Sonnet 4.6) to compare head geometry against the human-authored PR description and return a structured verdict (`pass` / `block` / `comment-only`) grounded in the metrics + DFM violations + 6-view renders the engine produces. Requires `ANTHROPIC_API_KEY` (set via the `env` block in your MCP config — see Setup).

Prompt:

```
Use cadgate.cad_judge to review this PR.

baseSource:
import cadquery as cq
result = cq.Workplane("XY").box(20, 20, 20)

headSource:
import cadquery as cq
result = cq.Workplane("XY").box(22, 22, 22)

prDescription:
Make the cube slightly bigger.
```

Expected (first call ~10–18s for sidecar + render + Anthropic; ~5s warm thanks to prompt caching):

| Field | Value |
|-------|-------|
| `verdict` | `"pass"` |
| `intentMatch` | `"matches"` |
| `reasons[0]` | mentions `+33%` volume or `22mm` bbox |
| `dfmViolations` | `[]` |
| `headMetrics.volume` | ≈ 10648 |
| `delta.volumeDeltaPct` | ≈ 33.1 |
| `modelId` | `"claude-opus-4-7"` |
| `promptCacheHit` | `false` first call → `true` on rerun within 5 min |

The response also includes the underlying `baseMetrics` / `headMetrics` / `delta` / `dfmViolations` so you can read the verdict and the supporting numbers in one tool turn — no need for a parallel `cad_diff` call.

To smoke-test the `block` path, swap `headSource` to a `0.5mm`-shelled cube and pass `rules: {version: 1, rules: [{id: 'min-wall-thickness', minMm: 1.2, severity: 'error'}]}`. The judge will report `verdict: block`, list the DFM violation as a reason, and (per Phase 3 verification) often distinguish the intent-match call from the policy violation in `noteForHuman`.

### Cost note

Opus 4.7 with 12 vision images runs ~$0.30 cold per call. Prompt caching (system prompt + tool schema + entire base side) drops repeat calls against the same base to ~$0.05 within the 5-minute cache TTL. Treat this as a reviewer-grade signal, not a per-keystroke linter.

### When the API key isn't configured

```json
{
  "ok": false,
  "error": {
    "code": "JUDGE_AUTH",
    "message": "Anthropic API key not configured. Restart cadgate mcp serve with --anthropic-api-key or ANTHROPIC_API_KEY env."
  }
}
```

Add the key to the `env` block in your MCP config (Setup section above), then `Cmd+Q` and reopen Claude Desktop.

## Closing the agentic loop

The whole point of the MCP server is making validation cheap *during* generation, not after. The full self-correction loop now runs entirely inside the chat:

```
Generate a CadQuery script for a 20×20×3 mm phone-stand bracket.

1. Use cadgate.cad_validate with rules:
   - min-wall-thickness = 1.2mm
   - watertight
   to check your output. If anything fails, rewrite and re-validate until clean.

2. Once cad_validate is clean, use cadgate.cad_judge with
   prDescription="20×20×3 mm phone-stand bracket"
   to confirm the geometry matches the intent.

3. If cad_judge returns verdict != "pass", read the reasons, rewrite, and
   loop back to step 1. Stop only when both cad_validate is clean AND
   cad_judge returns "pass".
```

What you should see: Claude generates → `cad_validate` (DFM violations, e.g. min-wall fails) → rewrites → `cad_validate` clean → `cad_judge` (verdict + intent check) → reads reasons → rewrites if `block` → loops until `pass` on both. The judge step catches "looks structurally fine but doesn't match the description" — exactly the failure mode metrics alone can't see.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Connector doesn't appear in Claude Desktop | Config not picked up — Claude Desktop wasn't fully quit | `Cmd+Q`, reopen. Background-reload doesn't re-read MCP config. |
| `DOCKER_UNAVAILABLE` error | Docker Desktop not running | Open Docker Desktop, retry. |
| `DOCKER_IMAGE_MISSING` | Sidecar images not pulled | `docker pull kiyeonj21/cadquery-sidecar:0.2 && docker pull kiyeonj21/build123d-sidecar:0.2` |
| `NO_DRIVER` | Source has no `import cadquery` / `import build123d` line | Add the import; the registry sniffs that to pick the right driver. |
| `CHROMIUM_UNAVAILABLE` (only on `cad_render`) | Chromium not installed | `brew install chromium` (macOS) or `apt install chromium-browser` (Linux). |
| `JUDGE_AUTH` (only on `cad_judge`) | `ANTHROPIC_API_KEY` not set at server start | Add `"env": {"ANTHROPIC_API_KEY": "sk-ant-..."}` to the cadgate entry in `claude_desktop_config.json`, then `Cmd+Q` and reopen. |
| `JUDGE_API` | Anthropic call failed (rate limit, model glitch, etc.) | Retry. Check `~/Library/Logs/Claude/mcp-server-cadgate.log` for the upstream error message. |
| `cad_validate` / `cad_judge` "not available" on first call | Claude's lazy tool-loading | Prime the session with the tool-list prompt above. |
| Tool call hangs > 60 s | First-time docker pull or stuck container | Check `docker ps`; the sidecar image's first run can be slow. Subsequent calls are fast. |

For deeper debugging, Claude Desktop logs MCP I/O at `~/Library/Logs/Claude/mcp-server-cadgate.log` — every JSON-RPC frame in and out, plus our server's stderr (init banner, lazy-Chromium warnings, etc.).

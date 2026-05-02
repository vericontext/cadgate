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

Calls Claude Opus 4.7 (or Sonnet 4.6) to compare head geometry against the human-authored PR description and return a structured verdict (`pass` / `block` / `comment-only`) grounded in the metrics + DFM violations + 6-view renders the engine produces. Requires `ANTHROPIC_API_KEY` (set via the `env` block in your MCP config — see Setup). Two prompts: a smoke test to verify the wiring, then the realistic case that demonstrates *why* the judge earns its keep.

### Smoke test — wiring is alive

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

Expected (first call ~10–18s; ~5s warm thanks to prompt caching):

| Field | Value |
|-------|-------|
| `verdict` | `"pass"` |
| `intentMatch` | `"matches"` |
| `delta.volumeDeltaPct` | ≈ 33.1 |
| `dfmViolations` | `[]` |
| `promptCacheHit` | `false` first call → `true` on rerun within 5 min |

Confirms sidecar + renderer + Anthropic + cache are all wired correctly. Useful but not interesting — any metric-only checker would also wave this through.

### Realistic case A — wrong shape primitive (semantic code error)

The interesting failures look like this: an LLM agent generates code that *looks* like it does what the PR says, all metrics check out, no DFM violations are triggered — but the actual geometry won't mate with the parts it has to mate with. This is exactly the failure mode `cad_judge` exists to catch.

```
Use cadgate.cad_judge to review this PR.

baseSource:
import cadquery as cq
result = cq.Workplane("XY").box(60, 60, 4)

headSource:
import cadquery as cq
result = (
    cq.Workplane("XY").box(60, 60, 4)
    .faces(">Z").workplane()
    .rect(10, 10).cutThruAll()
)

prDescription:
Add a Ø10 mm circular vent through the top face of the enclosure lid to mount a 10 mm axial fan for SoC cooling. The fan flange requires a round bore to seal against the lid surface — a non-round cutout will leak air and prevent the fan from mounting flush.
```

The agent used `.rect(10, 10)` instead of `.circle(5)` — a square cutout where the PR specifies a round one. **Pure metric check looks fine**: a cutout was added, volume went down, the part is still watertight (the inner cutout walls close the manifold), no DFM rule was triggered. A `cadgate check` without `--judge` would silently pass this PR.

Expected from `cad_judge`:

| Field | Value |
|-------|-------|
| `verdict` | `"block"` |
| `intentMatch` | `"differs"` |
| `delta.volumeDelta` | ≈ −400 (matches a 10×10×4 = 400 mm³ square hole) |
| `delta.watertightnessChanged` | `false` |
| `dfmViolations` | `[]` |
| `reasons` | calls out `.rect(10, 10)` vs Ø10 circular spec; cross-checks the −400 mm³ delta against the ~314 mm³ a Ø10 hole would remove; cites the PR's flush-mount + air-leak consequences |
| `noteForHuman` | suggests the concrete fix (`.circle(5).cutThruAll()`) and explicitly notes that DFM didn't flag this |

What the judge demonstrates here that a metric-only checker can't:

- **Reads the code, not just renders.** It identifies the wrong CadQuery primitive (`.rect`) by name and proposes the right one (`.circle`).
- **Cross-checks metrics against intent.** It notices that −400 mm³ is the expected delta for a *square* 10×10 hole, not the ~314 mm³ a circular Ø10 hole would remove — and uses that arithmetic mismatch as corroborating evidence on top of the visual reading.
- **Reads the PR's stated consequences.** The PR mentions "flush mount" and "air leak"; the judge surfaces those exact concerns in its reasoning, so the reviewer sees *why* the verdict matters in mating-part terms.
- **Knows when the rule engine is silent.** It explicitly states no DFM rule was triggered — telling the human "you can't rely on the policy gate alone for this class of failure."

Rerun the same prompt within 5 minutes — `promptCacheHit: true`, the call is perceptibly faster, and the verdict is identical (Opus 4.7 has no temperature, and the entire base side is cached, so the response is effectively deterministic for a given diff).

The response also includes the underlying `baseMetrics` / `headMetrics` / `delta` / `dfmViolations` alongside the verdict, so you can read the call and the supporting numbers in one tool turn — no need for a parallel `cad_diff`.

### Realistic case B — no-op PR (claimed feature missing entirely)

A different and extremely common LLM failure mode: *false completion*. The agent says "done" without actually doing the work — token limit hit mid-generation, context dropped, the wrong file was committed, whatever. The PR description claims a feature was added; the head source is byte-identical to base.

```
Use cadgate.cad_judge to review this PR.

baseSource:
import cadquery as cq
result = cq.Workplane("XY").box(40, 40, 5)

headSource:
import cadquery as cq
result = cq.Workplane("XY").box(40, 40, 5)

prDescription:
Add 4× M3 mounting holes (Ø3.4 mm clearance) at the corners of the lid, 5 mm in from each edge, for chassis attachment screws.
```

Notice the `headSource` is identical to `baseSource` — no holes anywhere. **What a metric-only checker sees: every single field is zero.** `volumeDelta: 0`, `surfaceAreaDelta: 0`, `triCountDelta: 0`, `bboxChanged: false`, `watertightnessChanged: false`, no DFM violations possible (nothing to check). The engine *cannot* tell something was supposed to change — the diff is genuinely empty.

Expected from `cad_judge`:

| Field | Value |
|-------|-------|
| `verdict` | `"block"` |
| `intentMatch` | `"differs"` |
| All `delta.*` numeric fields | `0` |
| `dfmViolations` | `[]` |
| `reasons` | calls out byte-identical sources; notes the would-be holes would have reduced volume + increased triangle count; reads renders showing plain solid plate; states explicitly "head source is identical to base" |
| `noteForHuman` | derives the correct geometry from the description (5 mm in from each edge of a 40 mm plate ⇒ 30 mm grid), then proposes the matching CadQuery idiom: `.faces(">Z").workplane().rect(30, 30, forConstruction=True).vertices().hole(3.4)` |

This is the cleanest demonstration of the judge's value: **metric-only and DFM-only checkers are silent because there's literally nothing to flag**. The judge's only signal is the contrast between PR text ("added 4 holes") and the engine's reality ("nothing changed"). It's the same thing a human reviewer does in 2 seconds — *"wait, you said you added holes, but the diff is empty"* — and the most direct demonstration of why a vision-equipped LLM judge belongs *next to* the engine, not as a replacement for it.

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

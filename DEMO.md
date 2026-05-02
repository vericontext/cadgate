# CADGate MCP Demo

End-to-end verification of `cadgate mcp serve` from a real MCP client (Claude Desktop). Every prompt below is copy-pasteable — paste, run, check the expected output.

## Prerequisites

| | Required for |
|--|--|
| **Claude Desktop** (or Cursor / Cline / Continue — any MCP-stdio client) | All tools |
| **Docker Desktop, running** | `cad_validate`, `cad_diff`, `cad_dfm_check`, `cad_render` |
| `kiyeonj21/cadquery-sidecar:0.2` + `kiyeonj21/build123d-sidecar:0.2` images | All tools (`docker pull` if not local) |
| **Chromium 120+** (`brew install chromium` / `apt install chromium-browser`) | `cad_render` only |

The binary itself is self-contained — Bun runtime + JS deps are bundled.

## Setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add a `mcpServers` entry. If the file already has other keys (`preferences`, etc.), keep them — only add `mcpServers`:

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

If you haven't run the install `curl` from the [README](./README.md#install-the-cli-locally), point `command` at the source build instead:

```json
"command": "/absolute/path/to/cadgate/dist/cadgate"
```

Quit Claude Desktop completely (`Cmd+Q`, **not** just close the window) and reopen. In the connector list (`+ → Connectors`), `cadgate` should appear with a `LOCAL DEV` badge and four tools listed under **Tool access** → **Other tools**: `cad_validate`, `cad_diff`, `cad_dfm_check`, `cad_render`.

## A note on Claude's lazy tool loading

Claude Desktop loads MCP tools on-demand based on prompt relevance. Your first prompt may have only 3 of the 4 tools in Claude's working set — if it tells you a tool isn't available, run this once to prime it:

```
List every MCP tool you can call from the cadgate connector. Print just the tool names.
```

After that, all four are accessible for the rest of the session.

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

Expected:

| Field | Value |
|-------|-------|
| `renders` | object with 6 keys: `front`, `back`, `top`, `bottom`, `left`, `right` |
| Each value | absolute PNG path (lives until MCP server shutdown) |

If Chromium isn't installed:

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

To inspect a render in chat:

```
Read the file at the "front" path you just got and show it to me.
```

If your Claude Desktop has filesystem access, the PNG embeds. Otherwise the path is on disk; open it in Finder.

## Closing the agentic loop

The whole point of the MCP server is making validation cheap *during* generation, not after. Try a self-correction loop:

```
Generate a CadQuery script for a 20×20×3 mm phone-stand bracket. Then use
cadgate.cad_validate (with rules: min-wall-thickness=1.2mm, watertight=true)
to check your output. If anything fails, rewrite the script and re-validate
until both rules pass.
```

What you should see: Claude generates → calls `cad_validate` with rules → reads violations → rewrites → calls `cad_validate` again → loops until clean.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Connector doesn't appear in Claude Desktop | Config not picked up — Claude Desktop wasn't fully quit | `Cmd+Q`, reopen. Background-reload doesn't re-read MCP config. |
| `DOCKER_UNAVAILABLE` error | Docker Desktop not running | Open Docker Desktop, retry. |
| `DOCKER_IMAGE_MISSING` | Sidecar images not pulled | `docker pull kiyeonj21/cadquery-sidecar:0.2 && docker pull kiyeonj21/build123d-sidecar:0.2` |
| `NO_DRIVER` | Source has no `import cadquery` / `import build123d` line | Add the import; the registry sniffs that to pick the right driver. |
| `CHROMIUM_UNAVAILABLE` (only on `cad_render`) | Chromium not installed | `brew install chromium` (macOS) or `apt install chromium-browser` (Linux). |
| `cad_validate` "not available" on first call | Claude's lazy tool-loading | Prime the session with the tool-list prompt above. |
| Tool call hangs > 60 s | First-time docker pull or stuck container | Check `docker ps`; the sidecar image's first run can be slow. Subsequent calls are fast. |

For deeper debugging, Claude Desktop logs MCP I/O at `~/Library/Logs/Claude/mcp-server-cadgate.log` — every JSON-RPC frame in and out, plus our server's stderr (init banner, lazy-Chromium warnings, etc.).

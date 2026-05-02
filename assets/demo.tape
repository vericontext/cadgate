# vhs tape — produces assets/demo.gif
#   Render with: vhs assets/demo.tape  (from repo root)
#
# Runs deterministically without an Anthropic API call: the cadgate
# wrapper defined below `Hide` injects a 4-second pause then prints a
# pre-captured judge verdict that we recorded once from a real
# Opus 4.7 call against this same fan-vent fixture. The verdict text
# in assets/demo/judge.json is verbatim from that recording.

Output assets/demo.gif

Set FontSize 18
Set Width 1100
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 55ms

Hide
Type "cd assets/demo"
Enter
Sleep 200ms
# Stub out cadgate so the demo runs without Docker / API keys / network.
# Progress lines stream to stderr during the simulated work, JSON to stdout
# at the end gets pretty-printed by the | jq downstream. Output is verbatim
# from one real Opus 4.7 call against this fixture (assets/demo/judge.json).
Type 'cadgate() { echo "  -> running head + base sources in cadquery sidecar (Docker)..." 1>&2; sleep 1.3; echo "  -> computing mesh metrics + rendering 6 views (manifold-3d, three.js)..." 1>&2; sleep 1.0; echo "  -> Claude Opus 4.7 vision judge (12 PNGs, tool_use, prompt cache)..." 1>&2; sleep 1.5; cat judge.json; }'
Enter
Sleep 200ms
Type "clear"
Enter
Show

# --- Frame 1: the head source the agent committed ---
Type "# Agent committed this lid for review:"
Sleep 400ms
Enter
Type "cat lid.py"
Enter
Sleep 4500ms

# --- Frame 2: what the human-authored PR description asked for ---
Type "# But the PR description says:"
Sleep 400ms
Enter
Type "cat pr-body.txt"
Enter
Sleep 5500ms

# --- Frame 3: invoke cadgate with the LLM judge ---
Type "cadgate check --judge opus --pr-description-file pr-body.txt | jq"
Sleep 600ms
Enter

# Progress lines stream during the wrapper's stepped sleeps (~3.8s total),
# then the captured verdict prints and jq pretty-formats it.
Sleep 7s

# Beat for the viewer to digest the verdict + reasons + fix.
Sleep 4s

# Punchline summary as a typed shell comment — not executed, just visible.
Type "# BLOCK -- intent differs -- proposed fix: .rect(10, 10) -> .circle(5)"
Enter
Sleep 3500ms

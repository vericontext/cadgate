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
# Output identical in structure to a real `--report json | jq '.files[0].judge'`.
Type "cadgate() { sleep 4; cat judge.json; }"
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

# 4s sleep inside the wrapper simulates Opus 4.7 vision-judge latency,
# then the captured verdict prints.
Sleep 7s

# Hold on the output so a viewer can read the verdict + reasons + fix.
Sleep 5s

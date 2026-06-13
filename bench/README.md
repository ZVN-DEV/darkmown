# Darkmown agent eval

Measures how well LLMs build and modify Darkmown sites **given only `AGENTS.md`** — and drives a loop that optimizes the sheet/docs until grades improve.

## How it runs

`bench/eval.workflow.js` is a Workflow script. For each **model × task**:

1. **Build** — the model gets only the agent sheet (staged at `/tmp/dmbench/SHEET.md`) and a task, and writes files to a temp dir.
2. **Compile** — the real Darkmown compiler must build the output (objective gate).
3. **Grade** — three persona judges (Stylist, Framework Purist, Product Owner) each score 0–5 with specific failures. Graders run on a fixed strong model for consistency across rounds.

Builders span the capability tiers: **Haiku 4.5, Sonnet 4.6, Opus 4.8, Fable 5**. (Opus 4.6 and Codex GPT-5.5 require the ZVN inference gateway and are added separately when reachable.)

## Tasks (dimensions under test)

| id | dimension |
|----|-----------|
| `styling` | modern visual styling via `.skin` |
| `content-edit` | updating content in an existing `.wd` |
| `optionality` | knowing to upgrade `.md` → `.wd` for interactivity |
| `scripting` | reaching for the `.js` escape hatch when directives can't express it |

## The loop

Each round's failure patterns feed edits to `AGENTS.md` (and docs). Re-run, compare. Scores are logged in `RESULTS.md`.

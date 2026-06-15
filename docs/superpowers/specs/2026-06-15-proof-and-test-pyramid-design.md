# Darkmown v0.9.0 — Proof + Full Test Pyramid (Design Spec)

Date: 2026-06-15
Status: Approved (Kirby, 2026-06-15)
Target release: v0.9.0

## Goal

Two outcomes in one release:

1. **Prove the moat.** Rework the landing hero into a side-by-side "live app in one `.wd` file vs. Markdoc (needs React)" proof — the thing that converts a skeptical Markdoc user in five seconds.
2. **Test everything, unit → e2e, and pass gold-standard-os.** Build a real test pyramid (unit, integration, zero-dep CLI e2e, and real-browser Playwright e2e), then run the gold-standard-os audit and fix findings to a passing score.

## Decisions (locked)

- **E2E harness:** Optional Playwright. Playwright is a **devDependency** behind `npm run test:e2e` and its **own CI job**. Default `npm test` and the **published package** stay zero-dependency. The zero-dep ethos is preserved where it actually matters (the runtime + what ships to consumers); real browser e2e is available for confidence and gold-standard credit.
- **Demo placement:** Rework the **landing hero** itself into the comparison centerpiece (highest first-visitor impact). The just-shipped whitespace + mobile-nav fixes must be preserved.
- **Sequencing:** gold-standard-os runs **after** the test pyramid exists, per Kirby's instruction ("fully pass /gold-standard-os after the tests are written").

## Part 1 — Landing hero: vs-Markdoc proof

**Headline:** "Markdown that runs. Not Markdown that needs React."

**Layout (centerpiece, replaces current hero):**
- **Left card — Darkmown:** the actual `.wd` source for a small store widget (live `:bind` search filter via `@loop … where`, per-row add-to-cart `cart += item`, `:computed` total), AND the **working widget rendered live** on the page. Caption: "This is the whole file. It runs."
- **Right card — Markdoc:** the honest equivalent — Markdoc `{% %}` source rendering a **static** list, plus a callout block showing the **React component + hydration + build wiring** you'd additionally write to make it interactive. Caption: "Same outcome needs a React component."
- Supporting row below: the existing value props (zero-JS static, one runtime, one loop) demoted to secondary.

**Honesty guardrails:**
- The Markdoc side MUST be fair and accurate (Markdoc genuinely has `{% if %}`, partials, variables; it genuinely lacks native loops and interactivity-without-React). A verification sub-agent fact-checks the Markdoc snippet before merge. No strawman.
- The homepage becomes **reactive** (`runtime:true`, loads ~3.1 KB runtime) by design — it proves "even our homepage is a `.wd` app." `/markdown/` and `/docs/` remain **static** (`runtime:false`) so the "static pages ship zero JS" claim still holds and is demonstrable.
- Preserve last sprint's spacing rhythm and mobile responsiveness.

## Part 2 — Test pyramid

| Layer | Tooling | Scope |
|---|---|---|
| Unit | `node:test` (zero-dep) | compiler grammar whitelists (computed/predicate/action), skin compiler, frontmatter parser, router, `getPath`, `loopKeyOf`, escaping. Backfill every gap. |
| Integration | `node:test` on temp-dir fixtures | full `compilePage`/`buildSite` for **every** directive + **every** compile-error path (actionable message asserted). |
| CLI/pipeline e2e | Node built-ins (zero-dep) | `darkmown init` in temp dir → `build` → `serve` → HTTP-fetch routes → assert HTML + `routes.json` + static/reactive gating. The real user journey, no browser. |
| Browser e2e | **Playwright** (optional devDep) | real browser drives `/reactive/`, `/data/`, and the new landing widget: search→filter, add-to-cart→cart+total update, counter increment, persist-across-reload, fetch loading/error/empty states. |

- `npm test` stays zero-dep + fast (unit + integration + CLI e2e all run here as top-level `tests/*.test.js`).
- `npm run test:e2e` runs Playwright; **separate CI job** (`npx playwright install --with-deps`).
- Add coverage via `node:test --experimental-test-coverage` with a threshold gate in CI.

## Part 3 — gold-standard-os pass

Run the gold-standard-os audit on the now-tested repo; fix to a passing score. Likely findings to address: coverage gate, public-API **types (`.d.ts` / JSDoc)** (deferred in v0.8.2; gold-standard usually requires them), issue/PR templates, `CODEOWNERS`, `dependabot`, docs/meta gaps. Note: a full Contributor-Covenant `CODE_OF_CONDUCT.md` trips an output content-filter — link or short-form it if required.

## Execution shape (staged)

**Stage 1 — parallel worktree tracks (no file overlap):**
- **Track A — Landing rework.** Owns `site/**`. Builds the widget + comparison; includes a Markdoc-accuracy fact-check.
- **Track B — Unit/integration backfill.** Owns NEW `tests/unit-*.test.js` (+ may make minimal `src/**` fixes if a unit test reveals a genuine bug — the only Stage-1 track permitted to touch `src/`). Does NOT touch `package.json`/CI.
- **Track C — CLI/pipeline e2e.** Owns NEW `tests/cli-e2e.test.js` (top-level so `npm test` includes it). Zero-dep, Node built-ins only. Reports (does not fix) any src bug it finds.
- **Track D — Browser e2e + tooling + CI.** Owns `package.json` (Playwright devDep + `test:e2e` + coverage scripts), NEW `playwright.config.js`, NEW `tests/e2e/**`, `.github/workflows/ci.yml` (e2e job + coverage gate). The ONLY track touching `package.json` and CI. Targets existing `/reactive/` + `/data/` flows (stable in parallel); landing-widget e2e added post-merge.

**Stage 2 — audit.** Run gold-standard-os on the merged, tested repo. Record score + prioritized findings.

**Stage 3 — harden.** Fix gold-standard P0/P1 (and cheap P2) findings.

**Then:** 5-agent review panel (PM, CEO, Security, Code Quality, UX/DX) → iterate → ship **v0.9.0** (merge to master, tag, release CI publishes).

## Success criteria

- [ ] Landing hero shows the live Darkmown widget + an accurate Markdoc comparison; mobile + spacing preserved.
- [ ] Homepage reactive; `/markdown/` + `/docs/` remain static (`runtime:false`).
- [ ] Test pyramid complete: unit, integration, CLI e2e (all in `npm test`, zero-dep), Playwright browser e2e (`npm run test:e2e`).
- [ ] `npm test` and the published package remain zero-dependency; Playwright is devDep-only.
- [ ] Coverage gate in CI; new e2e CI job green.
- [ ] gold-standard-os audit run; passing score with P0/P1 findings fixed.
- [ ] Review panel clears; released as v0.9.0.

## Out of scope
- First-party server runtime / `site/api/` (still parked).
- Re-enabling view transitions.
- Running Markdoc for real (no dep; its snippet is shown statically and fact-checked).

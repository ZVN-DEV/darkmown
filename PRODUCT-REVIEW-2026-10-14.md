# Darkmown: Critical Product Review (Second Pass)

**Date:** 2026-10-14
**Subject:** `@zvndev/darkmown` v2.10.0, Markdown-native web framework
**Previous review:** 2026-10-12 at v2.7.0, rated 8/10 (PRODUCT-REVIEW-2026-10-12.md)
**Method:** Five fresh research tracks (codebase, security, competition, engineering, UX/DX) with file:line evidence. Security findings were reproduced live. This review grades v2.10.0 as it ships today, including what changed in the 36 hours and three releases since the last pass.

---

## 1. What Is It?

Darkmown is a Markdown-native site framework: `.md` files compile to zero-JS static pages and `.wd` files add a closed, compile-validated directive grammar (state, loops, forms, components) served by a 6.6 KB gzipped runtime. Pure ESM JavaScript on Node 20+, three runtime dependencies, published on npm at v2.10.0 with build-time image variants, font subsetting, and compile-time include components added since 2.8. It is dogfooded on darkmown.com and battle-tested against a real client rebuild (the 67-route ToothDocs marketing site, CMS-driven, with published benchmark numbers).

---

## 2. Is It Real?

**Yes, and more so than at the last review.** The feature claims were verified against code and data, not accepted:

- 1,977 unit tests pass; the 100% src-only coverage gate holds at 18,997 measured lines; 79 browser e2e specs across three engines; the browser runtime itself is coverage-gated (89% of `src/runtime.js` lines, thresholded in `.runtime-coverage-snapshot.json`).
- The new features are real: the children slot expands at compile time with no runtime marker (`src/compiler/includes.js:248-285`); image variants generate and cache (verified in `dist/` and `node_modules/.cache/`); font subsetting measured on the client fonts (1.07 MB TTF to 288 KB woff2).
- The benchmarks page's numbers match the raw measurement artifacts byte-for-byte (318,276 B vs "318 KB", 56,744 B vs "56.7 KB").
- Three releases (2.8.0, 2.9.0, 2.10.0) shipped to npm in 36 hours, all installable and consumer-verified.

**Not yet built / known gaps:** SSR and live server content (deliberate refusal); font fallback metrics for CLS; no `sizes` emission on srcset; build-scale evidence past 67 routes; the VS Code extension is still unpublished and now missing 2.10 syntax. The playground bundle is three releases stale (see 8, this is the worst single finding).

**Verdict:** real, verified, shipping. The gap list is now mostly "what the framework refuses" plus one artifact-refresh failure.

---

## 3. Is It Offering Something Unique?

### What's genuinely differentiated

1. **The agent-authoring surface is now provably unoccupied.** GBNF grammar, machine-readable catalog, `validate` CLI with coded fix-hint errors, scaffolded agent context. The market moved the other way: Astro REMOVED its llms.txt in May 2026 and went MCP-only; nobody else ships a grammar for a web framework. As grammar-constrained decoding becomes standard for local models, this positioning strengthens.
2. **The correctness moat, reframed and stronger.** "Agents can't write React" is aging badly; "an agent's `.wd` output is provably correct before it ships, at zero runtime cost" is aging well. `darkmown validate` makes a generated page checkable without running it, which no generator producing React can offer.
3. **Content-derived font subsetting.** Scanning emitted HTML and subsetting fonts to exactly that charset: neither next/font (script-based unicode-range splits), Astro's Fonts API (no subsetting), Eleventy, nor Hugo does this. It is the one asset feature where Darkmown is ahead rather than at parity.
4. **Compile-time include components in Markdown** (`defaults:` + caller-scope `{ children }` + pairing diagnostics, zero runtime). Hugo's paired shortcodes are the only prior art, and they carry no defaults, no diagnostics, no reactive interop. First in the Markdown-native, zero-runtime class.
5. **Honest-loss benchmarking as a published artifact.** The `/benchmarks/` page names its own losses with numbers. Rare enough to be a differentiator in credibility.

### What's NOT differentiated

- Image variants (catch-up; Astro Image, Eleventy Image, Hugo, next/image all predate it). The sharp-optional degradation is the only distinctive bit.
- Per-route CSP (Astro's CSP API shipped March 2026 and is broader).
- serve api/ + compression (table-stakes parity).
- Zero-JS static output (Astro matches the floor in principle; Darkmown's edge is interactivity staying in one 6.6 KB shared runtime instead of growing per island).

**Differentiation verdict:** the core niche (closed grammar compiled to keyed reactive patches under a sub-7-KB runtime) remains unoccupied, the agent surface is now demonstrably unique in the market, and composition plus fonts moved from "missing" to "novel." The differentiators that matter are the ones competitors structurally cannot copy without becoming a different product.

---

## 4. Who Is This For?

**Target users:**

- **Agent-driven site generation.** The sharpest fit, sharpened further: GBNF-constrained authoring, coded errors an agent can repair against, `validate` as a pre-ship proof. v0/Lovable/Bolt generate unverifiable React; Darkmown generates verifiable Markdown. That is now an enterprise compliance story, not a hobbyist one.
- **Markdown-first content site owners** who want interactivity (live filtering, forms with field errors, carousels, theme) without a component framework or its bundle.
- **Performance-purist marketing sites**: measured 22 KB total JS per page vs 226 KB for the same site on Next.js, and now with the font and image pipelines that were the honest losses a week ago.

**Adjacent audiences and unlocks:**

- **Astro/11ty migrants** on small content sites: unlocked by the playground being current (it is not, see 8) and a build-scale story past 67 routes.
- **Design agencies shipping client marketing sites**: nearly unlocked by the ToothDocs demo (still private). The CMS sync pattern is the proof they need.
- **Docs-heavy product teams**: reachable only with docs search and versioning, neither built.

**Market positioning:** the rival is now Astro, not Next.js. Astro (Cloudflare-owned since January 2026, Rust-compiled, with Fonts and CSP APIs) owns "zero JS by default" mindshare and is marching toward heavier machinery, which widens Darkmown's philosophical gap: one Markdown line and a 6.6 KB shared runtime versus framework islands, Vite 8, and a Rust pipeline. The Next.js benchmark should be retired to a footnote; the numbers that sell the category now are Darkmown-vs-Astro (island JS growth, toolchain weight, agent-verifiability).

---

## 5. Security Audit

All seven v2.7.0 findings were re-verified: six fixed well (symlink, dotfile, `%00`, worker leak, measureImage, markdown-it advisory), two remain open (unbounded body buffering, secret-seed warning). The new code was audited directly. Reproduced live unless noted.

| # | Severity | Finding | Location | Impact |
|---|----------|---------|----------|--------|
| N1 | MEDIUM | Font subset pass follows symlinks out of the sandbox and publishes derived bytes to dist | `src/font-subset.js:401-421`, `:220` | Reproduced: a symlinked font at `site/pages/evil.ttf` targeting `/System/Library/Fonts/...` was read and its subset published. Direct bypass of the 2.10 symlink hardening this release shipped (which uses lstat/realpath everywhere else; this pass only checks lexically). Multi-author/CI threat model. Bounded: font files only, charset glyphs only. |
| N2 | MEDIUM | Route-name newline injection into `dist/_headers` | `src/router.js:95-102`, `src/builder.js:1341,1350-1354` | Reproduced: a filename containing a newline (legal on macOS/Linux, pushable via git) injects arbitrary config lines into the Cloudflare `_headers` file, e.g. a CSP downgrade for a path set. Every other sink escapes (sitemap XML, routes.json JSON, canonical HTML); `_headers` is the one raw-text config sink. Fix: reject control characters in `routeFromFile`. |
| N3 | LOW | Unbounded request-body buffering, still open and now reachable from `serve` too | `src/api-runner.js:132-140`, `src/cli.js:478` | Multi-GB POST OOMs the dev/serve process. Loopback-bound by default; `HOST` can widen it. Open since v2.7.0. |
| N4 | LOW | Stack/message disclosure under `serve`: URIError thrown outside the try block, and handler `err.message` echoed to clients | `src/api-runner.js:96,202,217-220`; `src/cli.js:482-485` | The production target (Cloudflare worker) was hardened to hide messages; the preview now leaks more than production. Inverted hardening. |
| N5 | LOW | No pixel-limit policy on sharp, no timeout on either spawnSync worker | `src/image-variant-resize.js:49-56`, `src/image-variants.js:244`, `src/font-subset.js:303` | A crafted 16k x 16k PNG passed probes and generated variants at ~277 MB peak RSS; a hung worker blocks the synchronous build forever. CI DoS primitive for a malicious author. |
| N6 | LOW | Synchronous brotli (quality 11) and per-request `routes.json` re-parse on serve | `src/statics.js:209-211,62` | CPU amplification on a localhost preview. Minor. |
| OPEN | LOW | No compiler warning for secret-shaped `:state`/`:store` seeds | not implemented | The hard rule remains prose-only. The JWT/base64-shape heuristic from the last review is still the right fix. |
| Info | — | Build caches copied verbatim into dist; `with`-arg `__proto__` neutralized | `src/image-variants.js:137`; `src/compiler/structure.js:472-493` | Standard CI-cache trust caveat (one line for SECURITY.md). The prototype-pollution probes all held: `Object.hasOwn` lookups, control-character slot key, escaped defaults. |

**What is done well:** the optional-dependency quarantine is genuinely good architecture (child process, results-file contract, degrade-to-hint, never fail the build); the include sandbox is double-checked and applied consistently; CSP stays hash-locked with no `unsafe-inline`/`unsafe-eval`; embed-host CSP union cannot carry CRLF (origin serialization is control-character-free by construction); include cycles and slot blowup are structurally capped (WD612, WD616, compile-once).

**Security verdict:** the posture remains strong and the fix culture is real, but this release's own signature hardening (symlink defense) was bypassed by its own newest module, and a config-injection MEDIUM sits in `_headers`. Both are one-line-class fixes; neither should survive to 2.10.1.

---

## 6. Engineering Quality

### What's great

- **The new tests are real.** `tests/font-subset.test.js` (566 lines) asserts `wOF2` magic bytes, cache-mtime semantics, CJK charset-divergence cache keys, wasm-level failure injection, idempotency under incremental rebuild. `tests/include-children.test.js` pins the pairing-rule edge cases and runtime assertions. Negative-path heavy, not change-detector.
- **Coverage gate honesty is intact for line coverage.** The spawnSync workers are instrumented (imported in-process by tests) and the enforced-net disclosures for the 6 exclusions are current. The runtime gate's thresholds sit below measured with dated notes naming the uncovered lines.
- **The docs machine is stronger than most OSS projects.** docs-parity (README sections require docs-page counterparts), docs-snippets (every `.wd` example in the docs is actually compiled), catalog-completeness, generated error registry with permanence rules. Three hand-maintained docs surfaces cannot silently drift.
- **Build noise discipline.** A full dogfood build prints exactly one hint, from a deliberately adversarial demo page. Every hint names a file and a fix command.

### What's good

- The worker architecture (sync API preserved, one child per build, temp-JSON IPC, degrade-to-unavailable) is sound; the pattern duplication between image and font workers is acknowledged in prose though not factored.
- The pairing-rule implementation for `@endinclude` (`src/compiler/structure.js:287`) is correct, fence-aware, and its backward-compat tradeoff (no unclosed-block error) is documented with the reasoning.
- Optional dependencies degrade gracefully: without them the build is byte-identical plus one actionable hint (verified by hand with big-image and @font-face scratch projects).

### What's bad

- **The publish pipeline has been broken for six weeks and was routed around three times instead of fixed.** `NPM_TOKEN` lost publish rights around Oct 2; every canary since failed; all three release workflows failed at `npm publish` (E404). The versions on npm were published manually hours later, **without provenance** (registry `dist.attestations` is null), which defeats the well-designed `release.yml` provenance guard. 2.8.0 was also tagged with its Windows CI leg red (the chmod-test failure class, which then recurred twice before being designed out).
- **`skinError` bypasses the coded-error contract, and the drift guard cannot see it.** `src/skin.js:379` is a factory returning plain `Error`, used at 8 author-facing throw sites (`src/skin.js:418-472`), carrying no WD code and no file:line, violating the registry's own stated contract (`src/errors.js:33`). The guard regex (`tests/error-codes.test.js:291`) scans for the literal `throw new Error(` and matches neither `throw skinError(...)` nor the factory body. The code comments say the registry "is owned by a parallel change"; that change never landed across three releases. The stopgap fossilized.

### What needs work

- **Playground rot with no gate** (`site/pages/playground/index.js`): a committed 415 KB bundle last regenerated 2026-09-04 (2.7.0). It cannot parse `skins:`, `$build`, pipes-in-raw-HTML, `@font-face`, or the flagship 2.10 include form, while the README claims it is "the same compiler the CLI ships." `runtime.min.js` (the other committed artifact) has a staleness gate in CI and release; the playground has none, and it ships in the npm tarball. This is exactly the failure class the project's own gates exist to catch, in the one place they don't reach.
- **wawoff2 is 4.5 years unmaintained** (last publish 2022-05-24) and ships opaque prebuilt wasm. The child-process quarantine mitigates, but a maintained alternative or a vendored, hash-pinned build deserves a look.
- optionalDependencies mirrored in devDependencies means consumers auto-install sharp + wasm (tens of MB native) whether they opt in or not; the docs' "npm i -D sharp to opt in" framing is moot for npm consumers. Make it a stated decision or move them out of optionalDependencies.
- Small staleness sweep: benchmarks page line 105 calls shipped font subsetting "on the roadmap"; `docs/spec-alignment.md:305` still says "As of v2.7.0"; store/dashboard template READMEs describe pre-2.8 serve behavior.

**Engineering verdict:** the core remains investor-grade (tests, coverage design, error registry, docs enforcement). The operational layer slipped: publish discipline, the playground artifact, and the error-code contract are all self-inflicted and all cheap to repair.

---

## 7. Competitive Landscape

| Capability | Darkmown 2.10 | Astro 7.3 (Cloudflare) | Eleventy 3.1 | Hugo 0.155+ | Markdoc / MDX+Next |
|---|---|---|---|---|---|
| Interactivity model | Closed grammar, keyed patches, 6.6 KB shared runtime | Framework islands (React/Vue/Svelte), payload grows per island | None built-in | None built-in | Full React runtime |
| Authoring unit | Markdown line | Framework component | Template + shortcode | Go template | JSX component |
| Component model | Compile-time includes, `defaults:`, `{ children }` slot | `.astro` + `<slot />` | WebC/shortcodes | Paired shortcodes (`{{.Inner}}`, no defaults/diagnostics) | JSX children |
| Image pipeline | sharp variants + author `@width` override | `astro:assets` (mature) | eleventy-img (mature) | Built-in | next/image CDN |
| Font pipeline | Content-derived charset subsetting (novel) | Fonts API: downloads/fallbacks/preloads, NO subsetting; has CLS metrics | None | None | next/font: script-based subsets + CLS metrics |
| Agent-authoring surface | GBNF + llms catalog + validate CLI + coded errors | MCP docs server; llms.txt removed | None | None | v0 generates this stack |
| Build perf (this site) | 2.7-3.6s, no cache, 0.6s CPU | Rust compiler, fast at scale | Fast mid-size | Fastest in class | 16.6-23.2s measured |
| Toolchain weight | 15 MB node_modules, zero deps | Node 22+, Vite 8, Rust pipeline | Light | Single binary | ~930 MB measured |
| SSR / live content | No (refusal) | Yes, Live Content Collections | No | No | Yes |
| Backing | Single vendor (ZVN) | Cloudflare | Community | Community | Stripe / Vercel |
| License | MIT | MIT | MIT | Apache 2.0 | MIT |

**Landscape verdict:** Darkmown's niche is still unoccupied and its unique surface (agent-verifiable authoring) got more valuable as AI-generated code flooded production. But the strategic rival has changed: Astro is now the name buyers say first for content sites, it has platform gravity from Cloudflare, and its Fonts/CSP APIs closed part of the asset gap. Darkmown wins the philosophical comparison (weight, provability, runtime floor) and has not yet won the at-scale or server-content comparison.

---

## 8. What to Fix Now

### Before anyone sees this (days, all small)

1. **N1: add the lstat/realpath guard to `resolveFontUrl`** (`src/font-subset.js:401-421`), mirroring `measureImage`'s `isAllowedInclude` use. The 2.10 symlink hardening is incomplete without it.
2. **N2: reject control characters in `routeFromFile`** (`src/router.js:95-102`). One regex, kills the `_headers` injection class (also audit other raw-text config sinks for the same assumption).
3. **Regenerate the playground bundle** (`scripts/build-playground.mjs`) and add a freshness `--check` to CI and `prepublishOnly`, exactly like `build-runtime.mjs --check`. Right now the public playground cannot parse the flagship 2.10 feature while the README claims compiler parity. This is the highest-visibility defect in the project.
4. **Rotate `NPM_TOKEN`** and republish 2.10.0's provenance attestation (or accept and document manual publishes). Six weeks of red canary and three provenance-less releases is a supply-chain posture the repo's own design says it does not accept.
5. **Fix the skinError contract violation**: register WD804+ codes for the skin at-rule errors in `src/errors.js`, route the 8 throw sites through `wdError`, and tighten the guard regex in `tests/error-codes.test.js:291` so factory indirection cannot evade it again.

### Before launch/promotion

6. **Update the stale surfaces**: benchmarks page "roadmap" line (it shipped), spec-alignment "As of v2.7.0", store/dashboard template READMEs (pre-2.8 serve text), VS Code extension grammar (missing `@endinclude`/`children`).
7. **Template modernization**: remove the emoji icons (still violating the project's own rule in `src/templates/landing` and `store/products.json`), and make the store template demo `defaults:` + `{ children }`. The templates are the second thing a new user sees; today they teach nothing from 2.8-2.10.
8. **N3-N5 hardening**: body-size cap in the api runner, move `matchApiRoute` decode inside the try and stop echoing stacks under serve, add `limitInputPixels` and a worker timeout.
9. **Decide the optionalDependencies story** (auto-install weight vs opt-in) and document it; evaluate replacing or vendoring wawoff2 (4.5 years stale).
10. **Implement the secret-seed warning** (open since the first review; small heuristic, big footgun).

### Can wait

11. Build-scale numbers (1k/10k-route public benchmark vs Astro 7 and Hugo; the at-scale narrative is currently conceded by silence).
12. Font fallback metrics / CLS protection (Astro and next/font both synthesize; the honest new gap).
13. An MCP server for the docs (industry drift direction; cheap given the catalog).
14. Publish the VS Code extension as-is (post-launch task per its own PUBLISHING.md).

---

## 9. The Verdict & Path Forward

### What's strong

- **The engineering core is genuinely elite**: 1,977 real tests, a coverage gate designed against self-deception, a permanent error-code registry, property fuzzing, docs enforced by compilation. The new code mostly meets that bar.
- **The product got materially better in 36 hours**: components (compile-time, principled), the asset pipeline (image parity, font novelty), security hardening (verified fixed), and an honest public benchmark with a real client site behind it.
- **The strategic position improved while the market moved.** Astro's march toward heavier machinery and the industry's generation-without-verification trend both widen Darkmown's lane. The moat is now provable correctness, and nothing else offers it.
- **The fix culture is real.** Every prior finding was addressed with regression tests, and the CHANGELOG admits its own history, including documenting a command before it existed.

### What's holding it back

- **Operational rot in exactly the two places the gates don't reach**: the playground artifact (no freshness gate, three releases stale, shipped in the tarball) and the publish pipeline (dead token, manual provenance-less releases, a tag cut on red CI). Neither is hard; both erode the "discipline is the differentiator" story precisely where a launch reviewer would look.
- **Two MEDIUM security findings introduced by this release's own newest code** (font symlink bypass, `_headers` injection). The hardening is inconsistent: fixed in one module, bypassed in its sibling.
- **The coded-error contract has a live bypass** (`skinError`) that the drift guard cannot see, which means the strongest structural guarantee (every author-facing error is coded) is currently false for one subsystem.
- **The templates teach the old product.** No `defaults:`, no children, no `skins:`, no fonts or images, plus the emoji violation the project itself bans. The first-run experience is now two releases behind the framework.
- **Conceded ground with no answer yet**: build-scale evidence, server-rendered fresh content (Astro's Live Collections), font CLS metrics.

### Strategic advice: **Launch strategy** (product is solid; publish discipline and proof points are the gap)

1. **Ship the fix sweep as 2.10.1 within days, not weeks** (items 1-5 above). The narrative "we found it, we fixed it in 48 hours, with regression tests" is the strongest version of the discipline story; sitting on two MEDIUMs through a launch is the worst.
2. **Publish the ToothDocs demo repo** (with the client's blessing) and update the benchmarks page to link it. The measured rebuild is the single most persuasive asset the project has; "private repo, no source link" halves its value. This is the killer demo: same CMS, same content, 22 KB of JS, 3-second builds, visible git history.
3. **Write the Astro comparison, not another Next one.** "Darkmown vs Astro for a content site in 2026: islands grow, a shared runtime doesn't" with honest numbers (per-island JS cost, toolchain weight, what Live Collections do that `:fetch` can't). Publish on the darkmown.com blog, post to r/webdev and the Astro Discord with the same respect-the-rival tone the benchmarks page already has.
4. **Announce the agent-verifiability angle where it lands**: a Show HN anchored on "a website format an LLM can prove correct before shipping" (the GBNF grammar + `validate` CLI demo), and a companion post for the local-model community (llama.cpp/Ollama Discords, r/LocalLLaMA) showing grammar-constrained site authoring end-to-end.
5. **Cut the launch releases from CI, not the laptop.** Rotate the token, and let `release.yml` do what it was designed to do. Provenance is a marketing feature for a framework selling discipline.

---

## 10. Rating

**8.5/10** (up from 8/10 at v2.7.0)

The product improved on every axis the first review measured: the two named gaps from that review are fixed and gated, the asset ceiling fell, composition arrived without costing the runtime, and the security fixes verified clean under re-audit. It does not reach 9 because this release cycle also introduced two MEDIUM security findings, shipped with a broken publish pipeline it routed around instead of fixing, let the public playground rot three releases behind the flagship feature, and let one subsystem bypass the error-code contract the project's discipline story is built on. All four are cheap, known, and fixable within a week; the software underneath them is the strongest it has ever been.

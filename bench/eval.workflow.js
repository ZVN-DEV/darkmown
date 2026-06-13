export const meta = {
  name: 'darkmown-agent-eval',
  description: 'Benchmark how well models build/modify Darkmown apps from AGENTS.md, graded by persona judges',
  phases: [
    { title: 'Build', detail: 'each model builds each task from the agent sheet' },
    { title: 'Compile', detail: 'real Darkmown compiler must build the output' },
    { title: 'Grade', detail: 'stylist / purist / product-owner judges score each build' }
  ]
}

// ---- Inputs (constants; edit between rounds — args proved flaky with scriptPath)
const SHEET_PATH = '/tmp/dmbench/SHEET.md'   // AGENTS.md under test — builders' ONLY framework read
const ROUND = 5
const REPO = '/Users/macbookpro-kirby/Desktop/Coding/ZVN/Markie-fw'
const MODELS = ['haiku', 'sonnet', 'opus']
// NOTE: given files for each task are PRE-SEEDED into each build dir before this
// runs (see bench/seed.sh). Builders edit/delete them in place; the compile
// stage must NOT recreate them.

// ---- Task suite -------------------------------------------------------------
const TASKS = [
  {
    id: 'styling',
    dimension: 'Modern styling',
    given: {},
    prompt: `Build a landing page at site/pages/index.wd for a fictional product "Lumen" (a focus-timer app). It needs a strong, modern hero, a 3-up feature section, and a footer. Style it to look like a polished 2026 product site using a colocated site/pages/index.skin. Start the page with @include /nav.wd. Assume site/_/nav.wd already exists.`
  },
  {
    id: 'content-edit',
    dimension: 'Content update',
    given: {
      'site/pages/pricing.wd': `---\ntitle: Pricing\n---\n\n@include /nav.wd\n\n<main>\n\n# Pricing\n\n::: section .tier\n## Starter\n$9/mo\n- 1 project\n:::\n\n::: section .tier\n## Pro\n$19/mo\n- 10 projects\n:::\n\n::: section .tier\n## Team\n$49/mo\n- Unlimited projects\n:::\n\n</main>\n`
    },
    prompt: `Edit site/pages/pricing.wd: change the Pro tier to $25/mo, add a line "**Most popular**" directly under the Pro heading, and add a fourth "Enterprise" tier priced "Contact us" with one feature "SSO & SLA". Keep the existing structure and style. Output the full edited file.`
  },
  {
    id: 'optionality',
    dimension: '.md → .wd optionality',
    given: {
      'site/pages/index.md': `---\ntitle: Newsletter\n---\n\n# Stay in the loop\n\nSubscribe for monthly updates.\n`
    },
    prompt: `The page site/pages/index.md should get a working newsletter signup: an email field and a Subscribe button that captures the email into state and then shows a thank-you message containing the submitted email. Make the minimal change needed to the project so this works.`
  },
  {
    id: 'scripting',
    dimension: 'Scripting / complex features',
    given: {
      'site/_/products.json': `[\n  {"id":1,"name":"Aurora Lamp","price":"$49"},\n  {"id":2,"name":"Briza Fan","price":"$39"},\n  {"id":3,"name":"Cove Speaker","price":"$89"},\n  {"id":4,"name":"Dune Mug","price":"$19"},\n  {"id":5,"name":"Ember Candle","price":"$15"},\n  {"id":6,"name":"Frost Bottle","price":"$29"}\n]\n`,
      'site/pages/products.wd': `---\ntitle: Products\n---\n\n@include /nav.wd\n\n<main>\n\n# Products\n\n:fetch products from "/__wd/data/products.json"\n\n:if products\n@loop products into p\n- **{ p.name }** — { p.price }\n@endloop\n:else\nLoading…\n:endif\n\n</main>\n`
    },
    prompt: `Add a search box above the product list on site/pages/products.wd that filters the visible products live as the user types. Output every file you create or change.`
  }
]

// ---- Grader personas --------------------------------------------------------
const PERSONAS = [
  {
    key: 'stylist',
    title: 'Senior product designer',
    rubric: `Judge ONLY the visual styling quality and modernity. 5 = looks like a polished, modern 2026 product site (deliberate type scale, spacing, color, hierarchy, responsive); 3 = clean but plain; 1 = unstyled, broken, or generic AI slop. Note whether they used a .skin file or CSS effectively. IMPORTANT fairness rule: if the task did NOT ask for new styling or visual/build work (e.g. a pure content edit that says "keep the existing style"), do not punish the absence of new styling — score 3 (neutral) when existing presentation is preserved, and only go below 3 if they actively broke or worsened the look. Reserve the full 0–5 range for tasks that involve building UI or explicitly request styling.`
  },
  {
    key: 'purist',
    title: 'Darkmown framework author',
    rubric: `Judge ONLY idiomatic Darkmown correctness. 5 = only real directives, the one @loop, the one { } interpolation, valid whitelisted button/computed grammar, correct .md vs .wd choice, .skin (or <style>) for styling, the colocated .js + window.wd escape hatch used where directives cannot express the logic; 1 = invented syntax (e.g. {% %}, :for, v-if, JSX), wrong framework concepts, or arbitrary JS shoved into directives. List every specific violation in failures[].`
  },
  {
    key: 'productowner',
    title: 'The user who made the request',
    rubric: `Judge ONLY whether the output fulfills the request completely and would actually work as asked. 5 = does exactly what I asked, complete and working; 1 = missed the point or badly incomplete. Ignore styling polish and framework purity — only: did they build what I asked for?`
  }
]

// ---- Helpers ----------------------------------------------------------------
const BUILD_SCHEMA = {
  type: 'object',
  required: ['dir', 'files', 'approach'],
  properties: {
    dir: { type: 'string', description: 'absolute temp dir where files were written' },
    files: { type: 'array', items: { type: 'string' }, description: 'relative file paths written under dir' },
    approach: { type: 'string', description: 'one sentence on the approach taken' }
  }
}
const COMPILE_SCHEMA = {
  type: 'object',
  required: ['compiled', 'errorText', 'warnings'],
  properties: {
    compiled: { type: 'boolean' },
    errorText: { type: 'string', description: 'compiler error output, empty if compiled' },
    warnings: { type: 'number' }
  }
}
const GRADE_SCHEMA = {
  type: 'object',
  required: ['score', 'rationale', 'failures'],
  properties: {
    score: { type: 'number', description: '0 to 5' },
    rationale: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } }
  }
}

function buildPrompt(task, dir) {
  const givenBlock = Object.keys(task.given).length
    ? `\n\nThe project ALREADY CONTAINS these files on disk under ${dir} (they are real files — edit them in place, and DELETE any that should be removed):\n` +
      Object.entries(task.given).map(([p, c]) => `--- ${p} ---\n${c}`).join('\n')
    : `\n\nThis is a fresh project (only the standard scaffold + site/_/nav.wd exist).`
  return `You are building a real Darkmown site for a user. Your ONLY framework reference is the Darkmown agent guide at this path:

  ${SHEET_PATH}

Read that guide first and build ONLY from it. You MAY read and edit files inside your own project dir ${dir}, but do NOT read Darkmown's framework source elsewhere, do NOT search the web, and do NOT use syntax that is not in the guide.

TASK:
${task.prompt}
${givenBlock}

Make all changes inside ${dir} (create subdirs as needed). Edit existing files in place; create new files; and **delete files that should no longer exist** (e.g. if you upgrade a .md to .wd, remove the .md). Use real, complete file contents. When done, return the dir, the list of relative file paths that should exist after your work, and one sentence on your approach.`
}

function compilePrompt(task, dir, build) {
  return `Objectively check whether a candidate Darkmown site compiles with the real compiler. Do NOT fix, improve, correct, add, or delete any candidate content — only ensure the build wrapper exists, then measure exactly what is on disk.

Steps (use Bash):
1. The candidate's project is under: ${dir} — leave its site/ files EXACTLY as the candidate left them (do not create, restore, or remove any page/partial/asset).
2. Only ensure the minimal build wrapper:
   - ensure ${dir}/package.json exists (create {"type":"module"} if missing)
   - ensure ${dir}/site/_/nav.wd exists; if missing, create it with one line: <nav class="topnav"><strong>Site</strong> <a href="/">Home</a></nav>
   (Do NOT touch anything under ${dir}/site/pages — whatever the candidate left, good or broken, is what gets measured.)
3. Run the real compiler with ${dir} as the working directory:  cd ${dir} && node ${REPO}/src/cli.js build
4. Report: compiled = true ONLY if the build exits 0 and writes ${dir}/dist/. Put the full error/stderr text in errorText (empty string if it compiled). Count lines starting with "hint:" or "warning:" into warnings.

Return strictly the schema.`
}

function gradePrompt(task, dir, build, compile, persona) {
  return `You are: ${persona.title}. You are grading one candidate's attempt at a Darkmown task.

THE TASK THE CANDIDATE WAS GIVEN:
${task.prompt}

THE CANDIDATE'S FILES are on disk under: ${dir}
Read them (use Read/Bash) to evaluate. Their stated approach: "${build.approach}".
Objective compile result: compiled=${compile ? compile.compiled : 'unknown'}${compile && compile.errorText ? `, error: ${compile.errorText.slice(0, 400)}` : ''}.

YOUR RUBRIC (score 0-5):
${persona.rubric}

Be a tough, specific grader. Score 0-5 (decimals ok). Give a one-paragraph rationale and a list of concrete failures (empty list if none). Return strictly the schema.`
}

// ---- Run --------------------------------------------------------------------
const items = []
for (const model of MODELS) for (const task of TASKS) items.push({ model, task })

log(`Round ${ROUND}: ${MODELS.length} models × ${TASKS.length} tasks = ${items.length} builds, each compiled + graded by ${PERSONAS.length} judges.`)

const results = await pipeline(
  items,
  // Stage 1 — build (varies by model)
  (it) => {
    const dir = `/tmp/dmbench/r${ROUND}/${it.model}__${it.task.id}`
    return agent(buildPrompt(it.task, dir), {
      label: `build:${it.model}:${it.task.id}`,
      phase: 'Build',
      model: it.model,
      schema: BUILD_SCHEMA
    }).then((build) => ({ ...it, dir, build }))
  },
  // Stage 2 — compile gate (fixed model, objective)
  (r) => {
    if (!r || !r.build) return null
    return agent(compilePrompt(r.task, r.build.dir, r.build), {
      label: `compile:${r.model}:${r.task.id}`,
      phase: 'Compile',
      model: 'haiku',
      schema: COMPILE_SCHEMA
    }).then((compile) => ({ ...r, compile }))
  },
  // Stage 3 — persona grading (fixed strong model for consistency)
  (r) => {
    if (!r) return null
    return parallel(
      PERSONAS.map((p) => () =>
        agent(gradePrompt(r.task, r.build.dir, r.build, r.compile, p), {
          label: `grade:${p.key}:${r.model}:${r.task.id}`,
          phase: 'Grade',
          model: 'opus',
          schema: GRADE_SCHEMA
        }).then((g) => ({ persona: p.key, ...g }))
      )
    ).then((grades) => ({
      model: r.model,
      task: r.task.id,
      dimension: r.task.dimension,
      approach: r.build.approach,
      compiled: r.compile ? r.compile.compiled : false,
      compileError: r.compile ? (r.compile.errorText || '').slice(0, 300) : 'no-compile-result',
      grades: grades.filter(Boolean)
    }))
  }
)

// ---- Aggregate --------------------------------------------------------------
const clean = results.filter(Boolean)
const scoreOf = (item, key) => {
  const g = item.grades.find((x) => x.persona === key)
  return g ? g.score : null
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const perModel = {}
for (const m of MODELS) {
  const rows = clean.filter((r) => r.model === m)
  const personaAvgs = {}
  for (const p of PERSONAS) personaAvgs[p.key] = +mean(rows.map((r) => scoreOf(r, p.key)).filter((x) => x != null)).toFixed(2)
  // overall per build: compiled ? mean(personas) : hard cap at 1.5
  const overalls = rows.map((r) => {
    const pm = mean(PERSONAS.map((p) => scoreOf(r, p.key)).filter((x) => x != null))
    return r.compiled ? pm : Math.min(pm, 1.5)
  })
  perModel[m] = {
    compileRate: +mean(rows.map((r) => (r.compiled ? 1 : 0))).toFixed(2),
    ...personaAvgs,
    overall: +mean(overalls).toFixed(2)
  }
}

const perTask = {}
for (const t of TASKS) {
  const rows = clean.filter((r) => r.task === t.id)
  perTask[t.id] = {
    dimension: t.dimension,
    compileRate: +mean(rows.map((r) => (r.compiled ? 1 : 0))).toFixed(2),
    purist: +mean(rows.map((r) => scoreOf(r, 'purist')).filter((x) => x != null)).toFixed(2),
    stylist: +mean(rows.map((r) => scoreOf(r, 'stylist')).filter((x) => x != null)).toFixed(2),
    productowner: +mean(rows.map((r) => scoreOf(r, 'productowner')).filter((x) => x != null)).toFixed(2)
  }
}

// Collect failure signals for doc optimization
const failurePatterns = []
for (const r of clean) {
  for (const g of r.grades) {
    for (const f of g.failures || []) failurePatterns.push(`[${r.task}/${r.model}/${g.persona}] ${f}`)
  }
  if (!r.compiled) failurePatterns.push(`[${r.task}/${r.model}/COMPILE] ${r.compileError}`)
}

return {
  round: ROUND,
  models: MODELS,
  perModel,
  perTask,
  overallMean: +mean(clean.map((r) => (r.compiled ? mean(PERSONAS.map((p) => scoreOf(r, p.key)).filter((x) => x != null)) : 1.5))).toFixed(2),
  failurePatterns,
  builds: clean.map((r) => ({ model: r.model, task: r.task, compiled: r.compiled, approach: r.approach, dir: `/tmp/dmbench/r${ROUND}/${r.model}__${r.task}` }))
}

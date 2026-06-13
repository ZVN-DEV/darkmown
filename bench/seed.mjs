// Pre-seed each build dir with the task's editable "given" files BEFORE the eval
// runs, so models genuinely edit/delete real files (and the compile stage never
// has to recreate them). Usage: node bench/seed.mjs <round>
import fs from 'node:fs';
import path from 'node:path';

const ROUND = process.argv[2] || '3';
const MODELS = ['haiku', 'sonnet', 'opus'];

// Mirror of TASKS[].given in eval.workflow.js — keep identical.
const GIVEN = {
  styling: {},
  'content-edit': {
    'site/pages/pricing.wd': `---\ntitle: Pricing\n---\n\n@include /nav.wd\n\n<main>\n\n# Pricing\n\n::: section .tier\n## Starter\n$9/mo\n- 1 project\n:::\n\n::: section .tier\n## Pro\n$19/mo\n- 10 projects\n:::\n\n::: section .tier\n## Team\n$49/mo\n- Unlimited projects\n:::\n\n</main>\n`
  },
  optionality: {
    'site/pages/index.md': `---\ntitle: Newsletter\n---\n\n# Stay in the loop\n\nSubscribe for monthly updates.\n`
  },
  scripting: {
    'site/_/products.json': `[\n  {"id":1,"name":"Aurora Lamp","price":"$49"},\n  {"id":2,"name":"Briza Fan","price":"$39"},\n  {"id":3,"name":"Cove Speaker","price":"$89"},\n  {"id":4,"name":"Dune Mug","price":"$19"},\n  {"id":5,"name":"Ember Candle","price":"$15"},\n  {"id":6,"name":"Frost Bottle","price":"$29"}\n]\n`,
    'site/pages/products.wd': `---\ntitle: Products\n---\n\n@include /nav.wd\n\n<main>\n\n# Products\n\n:fetch products from "/__wd/data/products.json"\n\n:if products\n@loop products into p\n- **{ p.name }** — { p.price }\n@endloop\n:else\nLoading…\n:endif\n\n</main>\n`
  }
};

let n = 0;
for (const model of MODELS) {
  for (const [taskId, files] of Object.entries(GIVEN)) {
    const root = `/tmp/dmbench/r${ROUND}/${model}__${taskId}`;
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      n++;
    }
  }
}
console.log(`Seeded ${n} files across ${MODELS.length} models for round ${ROUND}.`);

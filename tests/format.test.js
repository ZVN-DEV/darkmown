import assert from "node:assert/strict";
import test from "node:test";
import {
  AGGREGATES,
  applyPipeline,
  FORMATTERS,
  fmtAttr,
  parsePipes,
  validatePipes
} from "../src/compiler/format.js";

const f = (name, value, ...args) => FORMATTERS[name](value, args);

test("number / money / percent / round formatters", () => {
  assert.equal(f("money", 49), "$49.00");
  assert.equal(f("money", 1234.5), "$1,234.50");
  assert.equal(f("money", 10, "EUR"), "€10.00");
  assert.equal(f("number", 1234567), "1,234,567");
  assert.equal(f("number", 5.6789, 2), "5.68");
  assert.equal(f("percent", 0.42), "42%");
  assert.equal(f("percent", 0.1234, 1), "12.3%");
  assert.equal(f("round", 5.6789, 2), 5.68);
  assert.equal(f("round", 2.5), 3);
  // tolerant of junk numerics
  assert.equal(f("money", "not a number"), "$0.00");
});

test("date / time / datetime formatters are pure (no clock)", () => {
  const iso = "2026-06-27T15:30:00Z";
  // dateStyle medium is locale-stable enough to assert the year + month token.
  const d = f("date", iso, "medium");
  assert.match(d, /2026/);
  assert.match(d, /Jun/);
  // epoch ms (number) and numeric string both parse
  assert.equal(f("date", 0, "short"), f("date", "0", "short"));
  // unparseable input falls back to the raw value, never "Invalid Date"
  assert.equal(f("date", "tomorrow"), "tomorrow");
});

test("date-only strings format in UTC so the calendar date is build-machine independent", () => {
  // "2026-06-22" parses as UTC midnight; without the UTC guard, a machine west of
  // UTC would render "Jun 21". The guard keeps the written date.
  assert.equal(f("date", "2026-06-22", "medium"), "Jun 22, 2026");
  assert.equal(f("date", "2026-01-01", "medium"), "Jan 1, 2026");
  // A full datetime keeps local-zone behavior (an explicit instant, not a bare date).
  const dt = f("datetime", "2026-06-22T12:00:00Z");
  assert.match(dt, /2026/);
  // datetime over a date-only string is also stabilized in UTC (midnight).
  assert.match(f("datetime", "2026-06-22"), /Jun 22, 2026/);
});

test("text formatters", () => {
  assert.equal(f("upper", "hi"), "HI");
  assert.equal(f("lower", "HI"), "hi");
  assert.equal(f("capitalize", "hello world"), "Hello world");
  assert.equal(f("trim", "  x  "), "x");
  assert.equal(f("truncate", "the quick brown fox", 9), "the quick…");
  assert.equal(f("truncate", "short", 9), "short");
  assert.equal(f("default", "", "—"), "—");
  assert.equal(f("default", null, "—"), "—");
  assert.equal(f("default", "value", "—"), "value");
});

test("pluralize agrees number and word", () => {
  assert.equal(f("pluralize", 1, "item"), "1 item");
  assert.equal(f("pluralize", 3, "item"), "3 items");
  assert.equal(f("pluralize", 0, "item"), "0 items");
  assert.equal(f("pluralize", 2, "person", "people"), "2 people");
});

test("aggregate formatters over a list", () => {
  const cart = [{ price: 49 }, { price: 99 }, { price: 12.5 }];
  assert.equal(f("sum", cart, "price"), 160.5);
  assert.equal(f("avg", cart, "price"), 160.5 / 3);
  assert.equal(f("min", cart, "price"), 12.5);
  assert.equal(f("max", cart, "price"), 99);
  assert.equal(f("count", cart), 3);
  assert.equal(f("sum", [1, 2, 3]), 6); // bare number list, no field
  assert.equal(f("join", [{ n: "a" }, { n: "b" }], " / ", "n"), "a / b");
  assert.equal(f("count", null), 0);
});

test("AGGREGATES is shared with :computed", () => {
  assert.equal(AGGREGATES.sum([{ p: 2 }, { p: 3 }], "p"), 5);
  assert.equal(AGGREGATES.count([1, 2]), 2);
  assert.equal(AGGREGATES.min([], "p"), 0);
});

test("parsePipes splits path and stages, quotes intact", () => {
  assert.deepEqual(parsePipes("price"), { path: "price", stages: [] });
  assert.deepEqual(parsePipes("price | money"), {
    path: "price",
    stages: [{ name: "money", args: [] }]
  });
  assert.deepEqual(parsePipes('cart | sum:"price" | money'), {
    path: "cart",
    stages: [
      { name: "sum", args: ["price"] },
      { name: "money", args: [] }
    ]
  });
  // a separator inside a quoted arg is preserved
  assert.deepEqual(parsePipes('list | join:" | "'), {
    path: "list",
    stages: [{ name: "join", args: [" | "] }]
  });
  assert.deepEqual(parsePipes("n | round:2"), {
    path: "n",
    stages: [{ name: "round", args: [2] }]
  });
});

test("parseArg coerces numbers, booleans, null, barewords, and quoted strings", () => {
  assert.deepEqual(parsePipes('x | f:1:true:false:null:bare:"q"').stages[0].args, [
    1,
    true,
    false,
    null,
    "bare",
    "q"
  ]);
});

test("applyPipeline chains stages left to right", () => {
  const cart = [{ price: 49 }, { price: 99 }];
  assert.equal(applyPipeline(cart, parsePipes('cart | sum:"price" | money').stages), "$148.00");
  assert.equal(applyPipeline("  hello ", parsePipes("x | trim | capitalize").stages), "Hello");
});

test("validatePipes rejects unknown formatters with a corrective list", () => {
  const ctx = { file: "x.wd" };
  assert.doesNotThrow(() => validatePipes("price | money", ctx));
  assert.throws(() => validatePipes("price | bogus", ctx), /Unknown formatter "bogus"/);
  assert.throws(() => validatePipes("price | bogus", ctx), /Available: money, number/);
});

test("fmtAttr serializes to the compact runtime form", () => {
  assert.equal(
    fmtAttr(parsePipes('cart | sum:"price" | money').stages),
    '[["sum",["price"]],["money",[]]]'
  );
});

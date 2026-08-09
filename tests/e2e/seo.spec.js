import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// The SEO head, verified in a real browser against the REAL security headers
// the production host sends (src/statics.js mirrors vercel.json / _headers).
//
// The load-bearing question is CSP. Darkmown's whole 2.1 headline is that the
// reactive runtime is eval-free, so pages ship a strict `script-src 'self'
// 'sha256-…' 'inline-speculation-rules'` with no `'unsafe-inline'`. Inline
// `<script type="speculationrules">` needed an explicit CSP token to be allowed,
// so "an inline JSON-LD block is fine" is NOT something to take on faith: a
// blocked JSON-LD block would be invisible in the HTML source and simply absent
// from what a crawler's renderer sees. This test asserts the browser both keeps
// the block in the DOM and reports no policy violation for it.
// ---------------------------------------------------------------------------

/** Attach a CSP violation collector before any navigation. */
async function collectCspViolations(page) {
  /** @type {{ directive: string, blocked: string }[]} */
  const violations = [];
  await page.exposeFunction("__wdCsp", (entry) => violations.push(entry));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      // @ts-expect-error injected by exposeFunction
      window.__wdCsp({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  return violations;
}

test("the strict CSP does not block the inline JSON-LD block", async ({ page }) => {
  const violations = await collectCspViolations(page);
  const response = await page.goto("/blog/zero-js-by-default/");

  // The page really is being served the strict, eval-free SCRIPT policy. Scoped
  // to the script-src directive on purpose: style-src legitimately carries
  // 'unsafe-inline' (skins inline a style block), and that says nothing about
  // whether a script element is allowed.
  const csp = response?.headers()["content-security-policy"] ?? "";
  const scriptSrc = csp.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
  expect(scriptSrc).toContain("'self'");
  expect(scriptSrc).not.toContain("unsafe-inline");
  expect(scriptSrc).not.toContain("unsafe-eval");

  const payload = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent({ timeout: 5_000 });
  const nodes = JSON.parse(String(payload));
  expect(Array.isArray(nodes) ? nodes[0]["@type"] : nodes["@type"]).toBe("BlogPosting");

  expect(violations, `CSP blocked something: ${JSON.stringify(violations)}`).toEqual([]);
});

test("a static page's only script element is the inert JSON-LD data block", async ({ page }) => {
  await page.goto("/blog/zero-js-by-default/");
  const types = await page.$$eval("script", (nodes) => nodes.map((node) => node.type));
  expect(types).toEqual(["application/ld+json"]);
});

test("canonical and og:url agree, and the canonical URL resolves without a redirect", async ({
  page,
  baseURL
}) => {
  await page.goto("/docs/");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
  expect(canonical).toBe("https://darkmown.com/docs/");
  expect(ogUrl).toBe(canonical);

  // The path the canonical claims must be the path the host actually serves at
  // 200 locally, i.e. the trailing-slashed form the whole build agrees on.
  const path = new URL(String(canonical)).pathname;
  const direct = await page.request.get(`${baseURL}${path}`, { maxRedirects: 0 });
  expect(direct.status()).toBe(200);
});

test("every internal link on the home page points at a route that exists", async ({
  page,
  baseURL
}) => {
  await page.goto("/");
  const hrefs = await page.$$eval("a[href^='/']", (nodes) =>
    Array.from(new Set(nodes.map((node) => node.getAttribute("href") ?? "")))
  );
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) {
    const response = await page.request.get(`${baseURL}${href}`, { maxRedirects: 0 });
    expect(response.status(), `${href} did not resolve directly`).toBe(200);
  }
});

// Colocated behavior for the landing page, discovered by basename
// (site/pages/index.wd -> site/pages/index.js). It is the only hand-written
// JavaScript on this page; everything else is directives.
//
// The page authors its install command as a plain ```sh fence so the source
// stays free of raw HTML. The copy button is added here instead: progressive
// enhancement, so the command is still readable and selectable with JS off.

// Little Friend click ids for the calls to action. Markdown links take no
// data attributes, so they are stamped here.
const ctaIds = [
  ["/docs/", "cta.docs"],
  ["/playground/", "cta.playground"],
  ["/vs/markdoc/", "cta.compare"],
  ["https://github.com/", "cta.github"],
  ["https://vercel.com/new/", "cta.deploy_vercel"]
];
for (const link of document.querySelectorAll(".hero-cta a")) {
  const href = link.getAttribute("href") || "";
  const match = ctaIds.find(([prefix]) => href.startsWith(prefix));
  if (match) link.dataset.lf = match[1];
}

const installBlock = document.querySelector(".hero pre > code");

if (installBlock && navigator.clipboard) {
  const pre = installBlock.parentElement;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-cmd";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy install command");
  pre.classList.add("has-copy");
  pre.append(button);

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(installBlock.textContent.trim());
      // Little Friend is loaded on production builds only.
      if (typeof window.lf === "function") window.lf("track", "install.copy");
      button.textContent = "Copied";
      button.classList.add("is-copied");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("is-copied");
      }, 1600);
    } catch {
      button.textContent = "Select + ⌘C";
    }
  });
}

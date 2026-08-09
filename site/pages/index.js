// Colocated behavior for the landing page, discovered by basename
// (site/pages/index.wd -> site/pages/index.js). It is the only hand-written
// JavaScript on this page; everything else is directives.
//
// The page authors its install command as a plain ```sh fence so the source
// stays free of raw HTML. The copy button is added here instead: progressive
// enhancement, so the command is still readable and selectable with JS off.

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

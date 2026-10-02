// Named Little Friend events for darkmown.com, served as /little-friend.js on
// production builds only (scripts/little-friend.mjs). Goals match event names,
// so the GitHub, npm and Deploy to Vercel links each send their own.

window.lf =
  window.lf ||
  function () {
    // biome-ignore lint/complexity/noArguments: the Little Friend stub queues raw arguments.
    (window.lf.q = window.lf.q || []).push(arguments);
  };

/**
 * The named event for a link, or "" for links that have none.
 * @param {HTMLAnchorElement} link
 * @returns {string}
 */
function eventFor(link) {
  const host = link.hostname.replace(/^www\./, "");
  if (host === "github.com") return "github.click";
  if (host === "npmjs.com") return "npm.click";
  if (host === "vercel.com" && link.pathname.startsWith("/new")) return "deploy.click";
  return "";
}

/** @param {MouseEvent} event */
function onClick(event) {
  if (event.button > 1 || !(event.target instanceof Element)) return;
  const link = event.target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  const name = eventFor(link);
  if (name) window.lf("track", name);
}

document.addEventListener("click", onClick);
document.addEventListener("auxclick", onClick);

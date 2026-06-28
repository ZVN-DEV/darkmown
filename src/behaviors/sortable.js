// Behavior: drag-to-reorder for a `@loop … into … sortable` region.
//
// Pointer Events (mouse + touch) reorder the rows live for feedback; on drop the
// underlying :state/:store list is rewritten through the public `window.wd` API,
// so the keyed-loop reconciler repaints. Keyboard users reorder a focused row with
// Arrow Up/Down, with a polite live-region announcement. Pay-for-what-you-use:
// emitted only on pages that use `sortable`, as a standalone module.
//
// The compiler forbids where/sort/reverse/offset/limit on a sortable loop, so the
// visible row order always equals the array order: DOM indices map 1:1 to the list.

const wd = /** @type {any} */ (window).wd;
let helpSeq = 0;
if (wd) {
  for (const container of document.querySelectorAll("[data-wd-sortable]")) {
    initSortable(/** @type {HTMLElement} */ (container));
  }
}

/**
 * @param {HTMLElement} container The `data-wd-loop` region carrying data-wd-sortable.
 * @returns {void}
 */
function initSortable(container) {
  const key = container.getAttribute("data-wd-sortable") || "";
  const out = /** @type {HTMLElement} */ (
    container.querySelector("[data-wd-loop-out]") || container
  );
  const usesHandles = Boolean(out.querySelector("[data-wd-drag-handle]"));

  // Off-screen helpers: a shared instructions node (referenced via aria-describedby)
  // and a polite live region that announces the new position after a reorder.
  const help = offscreen("Press Arrow Up or Arrow Down to reorder this item.");
  help.id = `wd-sortable-help-${++helpSeq}`;
  const live = offscreen("");
  live.setAttribute("aria-live", "polite");
  container.append(help, live);

  /** @type {HTMLElement | null} */
  let dragRow = null;
  let startIndex = -1;

  /** @returns {HTMLElement[]} Row elements (keyed nodes) in current DOM order. */
  const rows = () =>
    /** @type {HTMLElement[]} */ (
      [...out.children].filter((c) => c.hasAttribute("data-wd-loop-key"))
    );

  // The keyed node is sometimes a `data-wd-loop-piece` wrapper the compiler adds
  // around a non-<li> row template; the author's styled element is then its child.
  // Visual feedback (dragging state), focus, and a11y must land on THAT element.
  /** @param {HTMLElement} row @returns {HTMLElement} */
  const visual = (row) =>
    row.hasAttribute("data-wd-loop-piece")
      ? /** @type {HTMLElement} */ (row.firstElementChild || row)
      : row;
  /** @param {HTMLElement} row @returns {HTMLElement} */
  const grip = (row) =>
    /** @type {HTMLElement} */ (visual(row).querySelector("[data-wd-drag-handle]") || visual(row));

  // Keep rows focusable + announced for assistive tech across every re-render, and
  // disable touch panning on the grip so a touch-drag reorders instead of scrolling.
  const decorate = () => {
    out.setAttribute("role", "list");
    const list = rows();
    list.forEach((row, i) => {
      const v = visual(row);
      const g = grip(row);
      v.setAttribute("role", "listitem");
      v.setAttribute("aria-roledescription", "sortable item");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
      g.setAttribute("aria-describedby", help.id);
      g.setAttribute("aria-posinset", String(i + 1));
      g.setAttribute("aria-setsize", String(list.length));
      g.style.touchAction = "none";
    });
  };
  wd.subscribe(key, decorate);

  out.addEventListener("pointerdown", (event) => {
    const target = /** @type {Element} */ (event.target);
    if (usesHandles && !target.closest("[data-wd-drag-handle]")) return;
    const row = /** @type {HTMLElement | null} */ (target.closest("[data-wd-loop-key]"));
    if (!row || !out.contains(row)) return;
    dragRow = row;
    startIndex = rows().indexOf(row);
    visual(row).setAttribute("data-wd-dragging", "");
    try {
      row.setPointerCapture(event.pointerId);
    } catch {
      /* element not capturable — drag still works via document hit-testing */
    }
    event.preventDefault();
  });

  out.addEventListener("pointermove", (event) => {
    if (!dragRow) return;
    const over = rowFromPoint(event.clientX, event.clientY);
    if (!over || over === dragRow) return;
    const list = rows();
    if (list.indexOf(dragRow) < list.indexOf(over)) over.after(dragRow);
    else over.before(dragRow);
  });

  const drop = () => {
    if (!dragRow) return;
    visual(dragRow).removeAttribute("data-wd-dragging");
    const endIndex = rows().indexOf(dragRow);
    dragRow = null;
    if (endIndex !== -1 && endIndex !== startIndex) reorder(startIndex, endIndex);
  };
  out.addEventListener("pointerup", drop);
  out.addEventListener("pointercancel", drop);

  out.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const row = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest("[data-wd-loop-key]")
    );
    if (!row) return;
    const list = rows();
    const from = list.indexOf(row);
    const to = event.key === "ArrowUp" ? from - 1 : from + 1;
    if (to < 0 || to >= list.length) return;
    event.preventDefault();
    reorder(from, to);
    // Re-focus the moved row's grip after the reconcile re-render, and announce it.
    requestAnimationFrame(() => {
      const moved = rows()[to];
      if (moved) {
        grip(moved).focus();
        live.textContent = `Moved to position ${to + 1} of ${rows().length}.`;
      }
    });
  });

  /**
   * @param {number} x
   * @param {number} y
   * @returns {HTMLElement | null}
   */
  function rowFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? /** @type {HTMLElement | null} */ (el.closest("[data-wd-loop-key]")) : null;
  }

  /**
   * Move the underlying list item from `from` to `to` and let the runtime repaint.
   * @param {number} from
   * @param {number} to
   * @returns {void}
   */
  function reorder(from, to) {
    const list = wd.get(key);
    if (!Array.isArray(list) || from < 0 || from >= list.length) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    wd.set(key, next);
  }
}

/**
 * A visually-hidden element (kept in the a11y tree) for instructions / live region.
 * @param {string} text
 * @returns {HTMLElement}
 */
function offscreen(text) {
  const node = document.createElement("div");
  node.textContent = text;
  node.style.cssText =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  return node;
}

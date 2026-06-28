// Behavior: a lightweight, accessible carousel.
//
// Native CSS scroll-snap (from the page skin) does the layout + touch swiping; this
// module adds prev/next buttons, dot navigation, active-state syncing, optional
// autoplay (`data-wd-carousel-autoplay="3000"`), and mouse drag-to-scroll. It needs
// NO reactive runtime — emitted only on pages that use `:carousel`, as a standalone
// `/__wd/behaviors/carousel.js` module.

for (const root of document.querySelectorAll("[data-wd-carousel]")) {
  initCarousel(/** @type {HTMLElement} */ (root));
}

/**
 * @param {HTMLElement} root The `:carousel` region.
 * @returns {void}
 */
function initCarousel(root) {
  const found = root.querySelector("[data-wd-carousel-track]");
  if (!found) return;
  const track = /** @type {HTMLElement} */ (found);
  const slides = /** @type {HTMLElement[]} */ ([...track.children]);
  if (slides.length === 0) return;

  // Honor the OS "reduce motion" setting: jump instead of smooth-scroll, and
  // never auto-advance (motion the user didn't initiate).
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "carousel");

  const prev = controlButton("‹", "Previous slide", "wd-carousel-prev");
  const next = controlButton("›", "Next slide", "wd-carousel-next");
  prev.addEventListener("click", () => go(currentIndex() - 1));
  next.addEventListener("click", () => go(currentIndex() + 1));

  // Plain buttons (not an ARIA tablist — there are no tabpanels to wire to);
  // the active dot is marked with aria-current="true".
  const dots = document.createElement("div");
  dots.className = "wd-carousel-dots";
  dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", "Choose slide to display");
  const dotButtons = slides.map((_, i) => {
    const dot = controlButton("", `Go to slide ${i + 1}`, "wd-carousel-dot");
    dot.addEventListener("click", () => go(i));
    dots.appendChild(dot);
    return dot;
  });

  root.append(prev, next, dots);

  /** @returns {number} Index of the slide nearest the track's scroll center. */
  function currentIndex() {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    slides.forEach((slide, i) => {
      const center = slide.offsetLeft + slide.clientWidth / 2;
      const dist = Math.abs(center - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  /** @param {number} i @returns {void} */
  function go(i) {
    const clamped = Math.max(0, Math.min(slides.length - 1, i));
    slides[clamped].scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      inline: "start",
      block: "nearest"
    });
  }

  function sync() {
    const i = currentIndex();
    dotButtons.forEach((dot, n) => {
      if (n === i) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
  }
  track.addEventListener("scroll", () => requestAnimationFrame(sync), { passive: true });
  sync();

  const interval = Number(root.getAttribute("data-wd-carousel-autoplay") || 0);
  if (interval > 0 && !reduceMotion) {
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    const advance = () => go(currentIndex() >= slides.length - 1 ? 0 : currentIndex() + 1);
    // start/stop are idempotent so stacked pointerleave/visibility events can't
    // spin up duplicate timers.
    const start = () => {
      if (timer === null) timer = setInterval(advance, interval);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    start();
    root.addEventListener("pointerenter", stop);
    root.addEventListener("pointerleave", start);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }

  // Mouse drag-to-scroll; touch already swipes natively via scroll-snap.
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") return;
    dragging = true;
    startX = event.clientX;
    startScroll = track.scrollLeft;
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable */
    }
  });
  track.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    track.scrollLeft = startScroll - (event.clientX - startX);
  });
  const release = () => {
    dragging = false;
  };
  track.addEventListener("pointerup", release);
  track.addEventListener("pointercancel", release);
}

/**
 * @param {string} label
 * @param {string} aria
 * @param {string} className
 * @returns {HTMLButtonElement}
 */
function controlButton(label, aria, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", aria);
  return button;
}

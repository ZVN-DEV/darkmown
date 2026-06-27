// Carousel behavior — the escape hatch in action.
//
// Darkmown owns the reactive `slide` state, the indicator dots (`.active when`),
// and the "Slide N of 5" readout. This colocated module adds exactly what a
// deliberately tiny framework leaves out: arrow + keyboard + pointer-drag navigation
// and the sliding transition. It never reaches into the framework's internals —
// it reads and writes the same `slide` value through the public `window.wd` API.
//
// Module scripts run after /__wd/runtime.js (which defines window.wd) and in
// document order, so `wd` is guaranteed ready here.

const viewport = document.querySelector("[data-swiper]");

if (viewport && window.wd) {
  const track = viewport.querySelector("[data-swiper-track]");
  const slides = [...track.children];
  const N = slides.length;
  const KEY = "slide";

  const wrap = (i) => ((i % N) + N) % N;
  const current = () => wrap(Number(window.wd.get(KEY)) || 0);
  const go = (i) => window.wd.set(KEY, wrap(i));
  const SETTLE = "transform .42s cubic-bezier(.22,.61,.36,1)";

  // State → view. Primed immediately, then on every settled change. Because the
  // arrows/keyboard/drag below always write a wrapped value, `slide` never leaves
  // [0, N-1], so the declarative dots and readout stay valid every frame.
  window.wd.subscribe(KEY, (raw) => {
    const i = wrap(raw);
    track.style.transition = SETTLE;
    track.style.transform = `translateX(${-i * 100}%)`;
    slides.forEach((s, k) => s.setAttribute("aria-hidden", k === i ? "false" : "true"));
  });

  // Arrow buttons (plain <button>s, wired here — not :button directives).
  document.querySelector("[data-swiper-prev]")?.addEventListener("click", () => go(current() - 1));
  document.querySelector("[data-swiper-next]")?.addEventListener("click", () => go(current() + 1));

  // Keyboard: the viewport is focusable; ← / → step through.
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(current() - 1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); go(current() + 1); }
  });

  // Pointer drag / touch swipe. Follow the finger while dragging (transition off),
  // then either advance or snap back on release.
  let startX = 0;
  let dragging = false;
  let width = 1;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    width = viewport.clientWidth || 1;
    track.style.transition = "none";
    try { viewport.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    track.style.transform = `translateX(calc(${-current() * 100}% + ${dx}px))`;
  });

  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    const dx = event.clientX - startX;
    if (Math.abs(dx) > width * 0.18) {
      go(current() + (dx < 0 ? 1 : -1));
    } else {
      // Below threshold: ease back to the current slide. The value didn't change,
      // so subscribe won't re-fire — reset the transform directly.
      track.style.transition = "transform .3s ease";
      track.style.transform = `translateX(${-current() * 100}%)`;
    }
  };

  viewport.addEventListener("pointerup", release);
  viewport.addEventListener("pointercancel", release);
}

# Darkmown animation parity vs our simple Next.js sites

Date: 2026-10-18. Sources read read-only: 7th-st-ortho origin/master, sso-dafko origin/master, teethworks-sites. Subject: Darkmown 2.12.2 in this repo.

## Wedge

Darkmown is markdown-native reactivity with zero-JS static output. Anything that forces JS onto every page dilutes that. Animation must stay opt-in per page, ideally CSS-first.

## What the originals actually do

All three originals (and teethworks-sites) use framer-motion, Swiper, and FormKit auto-animate. Observed patterns:

- Fixed header that changes on scroll: useScroll in 7th St Navigation.tsx drives background, shadow, and shrink as you scroll.
- Dropdown menus: AnimatePresence with opacity, y offset, and scale on enter and exit. Chevron rotates 180 degrees.
- Mobile menu: height and opacity expand/collapse.
- Hero and section entrances: initial/animate and whileInView fades and rises (4 files on 7th St, page-level on sso sites).
- Page change: AnimatePresence mode=wait fade between routes (sso page-animate-precense.tsx).
- Carousels: Swiper for testimonials and video.
- Hover micro-interactions: scale and color transitions (CSS in globals.css).

## Scorecard

| Capability | Next originals | Darkmown today | Verdict |
|---|---|---|---|
| CSS keyframes, transitions, hover | First-party | First-party (.skin @keyframes, transitions) | Parity |
| Sticky header that reacts to scroll | framer useScroll | Hand-written colocated .js (scroll listener + class) | BORROW P1: ship as a behavior module |
| Scroll reveal (whileInView) | framer whileInView | Hand-written .js IntersectionObserver per site | BORROW P0: ship reveal behavior like carousel |
| Dropdown/menu enter animation | AnimatePresence | CSS animation on :if mount works | Parity (enter only) |
| Dropdown/menu exit animation | AnimatePresence exit | None: :if removes instantly | BORROW P2: exit-aware :if or behavior |
| Carousel | Swiper | :carousel (scroll-snap, dots, drag) | Partial parity, good enough for these sites |
| Page transition fade | AnimatePresence wait | Instant swap by design (2.12.2 removed root animation to kill artifacts) | OUT-OF-SCOPE for now: speed is the wedge |
| List auto-animate (FLIP) | FormKit auto-animate | None (sortable has no FLIP) | P3 watch |
| Springs, gestures, shared layout | framer-motion | None, escape hatch .js only | OUT-OF-SCOPE: would make Darkmown a worse framer-motion |
| Reduced motion | Mixed | Skin @media guards, carousel honors it | Parity if authors write the guard |

## Bottom line for the three copies

Everything these particular sites do can be pulled off in Darkmown today, with no framework change: header scroll state, dropdown and mobile menu enter animations, hero entrances, and scroll reveals are .skin keyframes/transitions plus a small colocated .js per site. The one visible loss is exit animations on menus and route fades. Menus will close instantly instead of fading out.

## Roadmap if Kirby wants it native

- P0: a `reveal` behavior module under /__wd/behaviors/ (same loading pattern as carousel and sortable): elements with a reveal class start hidden only when JS runs, IntersectionObserver adds the in-view class once, prefers-reduced-motion shows everything immediately. Static pages without the class stay zero-JS.
- P1: a `scrolled` header behavior: toggles a class on a named element past a scroll threshold, so sticky header restyle is one line instead of hand JS per site.
- P2: exit animation support for :if regions (delay removal until a CSS animation ends). Needs runtime work and careful settle semantics.
- Refuse: a spring/gesture engine, FLIP list animation, and animated route cross-fades. Each fights the zero-JS, instant-page wedge.

## Outcome (2026-10-18, after the rebuild)

All three copies got the animation pass with zero added JavaScript: scroll-driven header state, dropdown and mobile menu enter motion, hero entrances, view-timeline reveals, carousel styling, and hover timing are pure .skin CSS (animation-timeline scroll() and view()), hidden states only inside @supports, reduced-motion guards throughout. Browser-verified: header shadow appears on scroll with the original value (0 8px 32px rgba(0,0,0,0.1) on 7th St), dropdown opens, carousel next advances and syncs dots. Confirmed gaps, as predicted: no exit animations (:if unmounts instantly; mounted toggles avoid it), no route fade (instant swap by design), no Swiper center-spotlight (no active-slide hook in :carousel), reveals scrub and reverse on scroll-up instead of playing once with stagger, and browsers without scroll timelines need a JS fallback Darkmown cannot attach sitewide (colocated .js is per page, includes carry no JS). Browser verification also caught what builds did not: content-box container padding overflow and a missing global img max-width reset. Those two resets belong in the skin guide or scaffold.

## Applied to this rebuild

The CMS rebuild now running recreates content and static design. A follow-up animation pass on each copy must add: fixed header with scroll state, animated dropdowns and mobile menu, hero entrance, scroll reveals, testimonial carousel motion, hover states, and reduced-motion guards, all committed with Darkmown notes on what the hand-written parts felt like.

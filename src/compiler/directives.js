// ---------------------------------------------------------------------------
// Directive handler barrel: the `handle*` family the body parser dispatches to,
// re-exported from the cohesive handler modules so `body.js` (and anything else
// reaching for a handler) has one import site. The implementations live in:
//
//   state.js      :state / :store / :computed / :theme + the declare* helpers
//   actions.js    the :button action parser + :button / :effect / :every
//   fetch.js      :fetch + the shared URL scheme guard (validateFetchUrl)
//   forms.js      :form + :input/:textarea/:select/:checkbox/:radio/:submit,
//                 and the bound controls :bind / :slider
//   media.js      :video / :audio / :embed (compile-time only, zero runtime)
//   structure.js  @include / ::: container / :if / :carousel + demo directives
// ---------------------------------------------------------------------------

export { handleButton, handleEffect, handleEvery } from "./actions.js";
export { handleFetch } from "./fetch.js";
export {
  handleBind,
  handleChoiceGroup,
  handleForm,
  handleInput,
  handleSelect,
  handleSlider,
  handleSubmit,
  handleTextarea
} from "./forms.js";
export { handleEmbed, handleMedia } from "./media.js";
export { handleComputed, handleState, handleStore, handleTheme } from "./state.js";
export {
  handleCarousel,
  handleContainer,
  handleIf,
  handleInclude,
  renderDemoDirective
} from "./structure.js";

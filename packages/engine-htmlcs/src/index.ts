export { createHtmlCsEngine } from './engine.js';
export { HTMLCS_ENGINE, HTMLCS_ENGINE_ID } from './metadata.js';
export {
  countHtmlCsMessages,
  criterionFromCode,
  htmlCsTypeName,
  normalizeHtmlCsResults,
  toSeverity,
} from './normalize.js';
export type { HtmlCsMessage, HtmlCsRawOutput, HtmlCsTarget } from './normalize.js';

/**
 * The local audit page.
 *
 * Hand-written HTML with inline CSS rather than a framework or a build step:
 * this page has one form and one list, and it has to be servable by a plain
 * Node handler with no bundler in the path. Keeping it a pure
 * `state -> string` function is also what makes it portable — a Worker could
 * serve the identical markup.
 *
 * Ally is an accessibility tool, so this page is held to the standard the rest
 * of the project reports on: one `h1`, a real `label` for the input, a `main`
 * landmark, status messages in a live region, and no colour-only signalling.
 */

/** One audit already present in the output directory. */
export interface StoredAudit {
  readonly slug: string;
  readonly url: string;
  readonly score: number;
  readonly finishedAt: string;
  /** True when a built report exists next to the artifact. */
  readonly hasReport: boolean;
}

export interface StudioPageState {
  readonly audits: readonly StoredAudit[];
  /** Shown when a previous submission failed. */
  readonly error?: string;
  /** Pre-fills the input after a failed submission. */
  readonly url?: string;
}

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1rem;
    background: #f8fafc;
    color: #0f172a;
    font: 16px/1.5 system-ui, -apple-system, sans-serif;
  }
  .layout { margin: 0 auto; max-width: 46rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.75rem; }
  h2 { margin: 2.5rem 0 .75rem; font-size: 1.125rem; }
  .lede { margin: 0 0 2rem; color: #475569; }
  form {
    padding: 1.25rem;
    border: 1px solid #cbd5e1;
    border-radius: .75rem;
    background: #fff;
  }
  label { display: block; font-weight: 600; margin-bottom: .375rem; }
  .row { display: flex; flex-wrap: wrap; gap: .75rem; }
  input[type=url] {
    flex: 1 1 20rem;
    padding: .625rem .75rem;
    border: 1px solid #94a3b8;
    border-radius: .375rem;
    background: #fff;
    color: inherit;
    font: inherit;
  }
  button {
    padding: .625rem 1.25rem;
    border: 1px solid #0f172a;
    border-radius: .375rem;
    background: #0f172a;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button[disabled] { opacity: .65; cursor: progress; }
  :focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
  .hint { margin: .75rem 0 0; color: #475569; font-size: .875rem; }
  .error {
    margin: 0 0 1.25rem;
    padding: .75rem 1rem;
    border: 2px solid #b91c1c;
    border-radius: .5rem;
    background: #fef2f2;
    color: #7f1d1d;
  }
  ul.audits { margin: 0; padding: 0; list-style: none; }
  ul.audits li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: .75rem;
    padding: .75rem 1rem;
    border: 1px solid #cbd5e1;
    border-radius: .5rem;
    background: #fff;
    margin-bottom: .5rem;
  }
  .score { font-weight: 700; font-variant-numeric: tabular-nums; }
  .when { color: #475569; font-size: .875rem; margin-left: auto; }
  .target { flex: 1 1 16rem; word-break: break-all; }
  footer { margin-top: 3rem; color: #475569; font-size: .875rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media (prefers-color-scheme: dark) {
    body { background: #020617; color: #e2e8f0; }
    form, ul.audits li { background: #0f172a; border-color: #334155; }
    input[type=url] { background: #020617; border-color: #475569; color: inherit; }
    button { background: #e2e8f0; color: #0f172a; border-color: #e2e8f0; }
    .lede, .hint, .when, footer { color: #94a3b8; }
    .error { background: #450a0a; border-color: #f87171; color: #fecaca; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
`;

/**
 * The submit handler.
 *
 * The audit is a blocking POST that takes tens of seconds, so the only job here
 * is to say that out loud and stop the reader submitting twice. Without
 * JavaScript the form still works — it just posts without the message.
 */
const SCRIPT = `
  var form = document.querySelector('form');
  var button = form && form.querySelector('button');
  var status = document.getElementById('submit-status');

  if (form && button && status) {
    form.addEventListener('submit', function () {
      button.disabled = true;
      button.textContent = 'Auditing…';
      status.textContent =
        'Running four engines and the keyboard analysis, then building the report. This usually takes 15 to 40 seconds.';
    });
  }
`;

export function renderStudioPage(state: StudioPageState): string {
  const audits =
    state.audits.length === 0
      ? '<p class="hint">No audits yet. Run one above.</p>'
      : `<ul class="audits">${state.audits.map(renderAudit).join('')}</ul>`;

  const error =
    state.error === undefined
      ? ''
      : `<p class="error" role="alert"><strong>The audit failed.</strong> ${escapeHtml(state.error)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ally — run an audit</title>
<style>${STYLES}</style>
</head>
<body>
<div class="layout">
<main id="main">
<h1>Ally</h1>
<p class="lede">Run an accessibility audit against a page and read the report.</p>

${error}

<form method="post" action="/audit">
  <label for="url">URL to audit</label>
  <div class="row">
    <input
      id="url"
      name="url"
      type="url"
      inputmode="url"
      required
      placeholder="https://example.com"
      value="${escapeHtml(state.url ?? '')}"
      autocomplete="url"
    >
    <button type="submit">Run audit</button>
  </div>
  <p class="hint" id="submit-status" role="status">
    Four engines plus a keyboard and focus analysis. Takes 15 to 40 seconds.
  </p>
</form>

<h2>Previous audits</h2>
${audits}
</main>

<footer>
  <p>
    Ally reports automated results only. It does not establish WCAG conformance and does not
    replace manual accessibility review.
  </p>
  <p>
    This server is bound to <code>127.0.0.1</code>. It opens a browser against whatever URL it is
    given, so do not expose it to a network.
  </p>
</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function renderAudit(audit: StoredAudit): string {
  const target = escapeHtml(audit.url);
  const when = escapeHtml(formatWhen(audit.finishedAt));

  // Without a report there is nothing to link to, and saying so beats a dead
  // link or a link that 404s.
  const label = audit.hasReport
    ? `<a href="/reports/${encodeURIComponent(audit.slug)}/">${target}</a>`
    : `${target} <span class="hint">(no report built)</span>`;

  return `<li>
    <span class="score">${String(audit.score)}<span class="hint"> / 100</span></span>
    <span class="target">${label}</span>
    <span class="when">${when}</span>
  </li>`;
}

function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? 'unknown time'
    : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Escapes text for HTML.
 *
 * The audited URL is attacker-controlled in the sense that it comes from a form
 * field, so it is escaped rather than trusted — even on a local server.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import DOMPurify from 'dompurify';
import mathPlugin, { renderTex } from './math.js';
import { loaded, loadHighlighter } from './lazy.js';

/**
 * The renderer is deliberately a pure `markdown -> html` function: everything
 * that depends on the environment (resolving relative image paths, opening
 * links) happens later, on the parsed DOM, so the same HTML can be exported.
 */

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(code, lang) {
    if (!lang) return md.utils.escapeHtml(code);
    const hljs = loaded.hljs;
    // Plain until highlight.js arrives; `upgradeRendered` colours it then.
    if (!hljs) {
      loadHighlighter();
      return md.utils.escapeHtml(code);
    }
    if (hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through to plain text */
      }
    }
    return md.utils.escapeHtml(code);
  },
})
  .use(mathPlugin)
  .use(footnote)
  .use(deflist)
  .use(mark)
  .use(sub)
  .use(sup)
  .use(taskLists);

/**
 * GitHub-style `- [ ]` / `- [x]` task lists. Small enough to keep in-tree, and
 * this version tracks the source line of each checkbox so the preview can flip
 * one without a full re-parse.
 */
function taskLists(mdi) {
  mdi.core.ruler.after('inline', 'task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      if (tokens[i - 1].type !== 'paragraph_open') continue;
      if (tokens[i - 2].type !== 'list_item_open') continue;
      const match = /^\[([ xX])\][ \t]+/.exec(tokens[i].content);
      if (!match) continue;

      const checked = match[1] !== ' ';
      const line = tokens[i - 2].map ? tokens[i - 2].map[0] : -1;

      tokens[i].content = tokens[i].content.slice(match[0].length);
      const children = tokens[i].children;
      if (children && children.length && children[0].type === 'text') {
        children[0].content = children[0].content.replace(/^\[([ xX])\][ \t]+/, '');
      }

      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content =
        `<input class="task-checkbox" type="checkbox" data-line="${line}"` +
        `${checked ? ' checked' : ''}> `;
      children.unshift(checkbox);

      tokens[i - 2].attrJoin('class', 'task-list-item');
      tokens[i - 1].attrJoin('class', 'task-paragraph');
      // Mark the enclosing list so the bullets can be hidden by CSS.
      for (let j = i - 3; j >= 0; j--) {
        if (tokens[j].type === 'bullet_list_open') {
          tokens[j].attrJoin('class', 'contains-task-list');
          break;
        }
      }
    }
  });
}

/**
 * Stamp every top-level block with its source line range. The preview uses
 * these for scroll sync and to map an edited block back to the source text.
 */
md.core.ruler.push('source_lines', (state) => {
  for (const token of state.tokens) {
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    token.attrSet('data-line', String(token.map[0]));
    token.attrSet('data-line-end', String(token.map[1]));
  }
});

// markdown-it's built-in fence/code renderers drop token attributes, so the
// source-line stamps above would be lost. Re-implement them minimally.
md.renderer.rules.fence = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
  const lang = info.split(/\s+/g)[0] || '';
  const highlighted = options.highlight
    ? options.highlight(token.content, lang) || md.utils.escapeHtml(token.content)
    : md.utils.escapeHtml(token.content);
  const langClass = lang ? ` class="language-${md.utils.escapeHtml(lang)} hljs"` : ' class="hljs"';
  return `<pre${self.renderAttrs(token)}><code${langClass}>${highlighted}</code></pre>\n`;
};

md.renderer.rules.code_block = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx];
  return `<pre${self.renderAttrs(token)}><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
};

// Raw HTML blocks get wrapped so they carry a line stamp too.
md.renderer.rules.html_block = (tokens, idx) => {
  const token = tokens[idx];
  const line = token.map ? ` data-line="${token.map[0]}" data-line-end="${token.map[1]}"` : '';
  return `<div class="raw-html"${line}>${token.content}</div>\n`;
};

// Math block: emit the line stamp alongside the KaTeX output.
const baseMathBlock = md.renderer.rules.math_block;
md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
  const html = baseMathBlock(tokens, idx, options, env, self);
  const token = tokens[idx];
  if (!token.map) return html;
  return html.replace(
    '<div class="math math-block"',
    `<div class="math math-block" data-line="${token.map[0]}" data-line-end="${token.map[1]}"`,
  );
};

// Keep the author's footnote label on the reference so an in-preview edit can
// round-trip `[^note]` instead of the printed number.
const baseFootnoteRef = md.renderer.rules.footnote_ref;
md.renderer.rules.footnote_ref = (tokens, idx, options, env, self) => {
  const html = baseFootnoteRef(tokens, idx, options, env, self);
  const label = tokens[idx].meta?.label;
  if (!label) return html;
  return html.replace('<sup class="footnote-ref"', `<sup class="footnote-ref" data-footnote-label="${md.utils.escapeHtml(label)}"`);
};

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan', 'start', 'checked', 'disabled', 'id'],
  ADD_TAGS: ['annotation', 'semantics', 'mstyle'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['srcdoc', 'formaction'],
};

/** Render markdown source to sanitized HTML. */
export function renderMarkdown(source) {
  return DOMPurify.sanitize(md.render(source), PURIFY_CONFIG);
}

/**
 * Bring already-rendered HTML up to date with the libraries that have loaded
 * since it was rendered: highlight the code printed plain, typeset the TeX
 * printed as source. Only the code and math elements are touched. They are
 * read-only in the preview, so no caret or in-progress edit is disturbed, and
 * the result is what a fresh render would give — the next patch finds them
 * unchanged. Returns whether anything changed.
 */
export function upgradeRendered(root) {
  let changed = false;
  if (loaded.katex) {
    for (const pending of root.querySelectorAll('.math > .math-pending')) {
      const host = pending.parentElement;
      host.innerHTML = DOMPurify.sanitize(
        renderTex(host.getAttribute('data-math') ?? '', host.classList.contains('math-block')),
        PURIFY_CONFIG,
      );
      changed = true;
    }
  }
  if (loaded.hljs) {
    for (const code of root.querySelectorAll('pre > code[class*="language-"]')) {
      if (code.firstElementChild) continue;
      const lang = /language-([^\s]+)/.exec(code.className)?.[1];
      if (!lang || !loaded.hljs.getLanguage(lang)) continue;
      const html = md.options.highlight(code.textContent, lang);
      code.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
      changed = true;
    }
  }
  return changed;
}

export { md };

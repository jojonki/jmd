import katex from 'katex';

/**
 * markdown-it plugin: `$…$` inline math and `$$…$$` block math, rendered with
 * KaTeX. Kept in-tree (rather than pulling another dependency) so the escaping
 * rules stay predictable: a `$` only opens math when it is not followed by
 * whitespace, and only closes when it is not preceded by whitespace, which
 * keeps prose like "it costs $5 and $6" from turning into math.
 */

function isWhitespace(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** True when the `$` at `pos` is escaped by a backslash. */
function isEscaped(src, pos) {
  let backslashes = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c; i--) backslashes++;
  return backslashes % 2 === 1;
}

function inlineMath(state, silent) {
  const src = state.src;
  let pos = state.pos;
  if (src.charCodeAt(pos) !== 0x24 /* $ */) return false;
  if (isEscaped(src, pos)) return false;

  // `$$…$$` on a single line is also accepted inline.
  const doubled = src.charCodeAt(pos + 1) === 0x24;
  const marker = doubled ? '$$' : '$';
  const start = pos + marker.length;
  if (start >= src.length) return false;
  if (!doubled && isWhitespace(src.charCodeAt(start))) return false;

  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src.charCodeAt(i) !== 0x24 || isEscaped(src, i)) continue;
    if (doubled) {
      if (src.charCodeAt(i + 1) === 0x24) { end = i; break; }
      continue;
    }
    // A lone closing `$` must hug the content and not be a digit-run like $5.
    if (isWhitespace(src.charCodeAt(i - 1))) continue;
    end = i;
    break;
  }
  if (end < 0 || end === start) return false;

  const content = src.slice(start, end);
  if (!content.trim()) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = marker;
    token.content = content;
  }
  state.pos = end + marker.length;
  return true;
}

function blockMath(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (start + 2 > max) return false;
  if (state.src.slice(start, start + 2) !== '$$') return false;

  const firstLine = state.src.slice(start + 2, max);
  if (silent) return true;

  let lastLine = null;
  let nextLine = startLine;
  let found = false;

  // `$$ x = 1 $$` all on one line.
  if (firstLine.trim().endsWith('$$')) {
    found = true;
    lastLine = firstLine.trim().slice(0, -2);
  }

  while (!found) {
    nextLine++;
    if (nextLine >= endLine) break;
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineMax = state.eMarks[nextLine];
    if (lineStart < lineMax && state.tShift[nextLine] < state.blkIndent) break;
    const line = state.src.slice(lineStart, lineMax);
    if (line.trim().endsWith('$$')) {
      found = true;
      lastLine = line.trim().slice(0, -2);
    }
  }

  const body = [];
  if (lastLine === null) {
    // Unterminated block: treat the rest of the chunk as math anyway.
    body.push(firstLine);
    for (let i = startLine + 1; i < endLine; i++) {
      body.push(state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]));
    }
    nextLine = endLine;
  } else {
    if (firstLine.trim()) body.push(firstLine);
    for (let i = startLine + 1; i < nextLine; i++) {
      body.push(state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]));
    }
    if (lastLine.trim()) body.push(lastLine);
  }

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '$$';
  token.content = body.join('\n').trim();
  token.map = [startLine, nextLine + 1];

  state.line = nextLine + 1;
  return true;
}

function render(content, displayMode) {
  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: true,
      strict: false,
      output: 'html',
      trust: false,
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const escaped = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const raw = content.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return `<span class="math-error" title="${escaped}">${raw}</span>`;
  }
}

export default function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.after('blockquote', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math math-inline" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${render(tokens[idx].content, false)}</span>`;

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math math-block" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${render(tokens[idx].content, true)}</div>\n`;
}

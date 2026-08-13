import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { renderMarkdown } from '../markdown/renderer.js';

/**
 * Edit-in-preview support.
 *
 * The markdown source stays the single source of truth. When the user types in
 * the preview, we wait for a pause, convert only the *touched* blocks back to
 * markdown, and splice those lines into the source. Restricting the conversion
 * to the touched span is what keeps the rest of the user's formatting (their
 * choice of `*` vs `_`, their line wrapping, their raw HTML) exactly as written.
 */

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  br: '  ',
  blankReplacement: (content, node) => (node.isBlock ? '\n\n' : ''),
});
turndown.use(gfm);

// Math is atomic: recover the original TeX from the stamp the renderer left.
turndown.addRule('math', {
  filter: (node) => node.classList?.contains('math'),
  replacement: (_content, node) => {
    const tex = node.getAttribute('data-math') ?? '';
    return node.classList.contains('math-block') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
});

// Raw HTML blocks round-trip verbatim rather than through the markdown grammar.
turndown.addRule('rawHtml', {
  filter: (node) => node.classList?.contains('raw-html'),
  replacement: (_content, node) => `\n\n${node.innerHTML.trim()}\n\n`,
});

// Footnote references keep their original label instead of the printed number.
turndown.addRule('footnoteRef', {
  filter: (node) => node.classList?.contains('footnote-ref'),
  replacement: (_content, node) => `[^${node.getAttribute('data-footnote-label') ?? node.textContent.replace(/[[\]]/g, '')}]`,
});

// Images keep the path as authored, not the resolved jmd-file:// URL.
turndown.addRule('image', {
  filter: 'img',
  replacement: (_content, node) => {
    const alt = node.getAttribute('alt') ?? '';
    const src = node.getAttribute('data-src') || node.getAttribute('src') || '';
    const title = node.getAttribute('title');
    return src ? `![${alt}](${src}${title ? ` "${title}"` : ''})` : '';
  },
});

// Fenced code: use the raw text, never the syntax-highlighted markup.
turndown.addRule('fencedCode', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const code = node.querySelector('code');
    const text = (code ?? node).textContent.replace(/\n$/, '');
    const className = code?.getAttribute('class') ?? '';
    const lang = /language-([\w+#-]+)/.exec(className)?.[1] ?? '';
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
    return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
  },
});

// Turndown indents list items as `-   item`. Emit the conventional `- item`
// instead, so a list that gets touched still looks like the rest of the file.
turndown.addRule('listItem', {
  filter: 'li',
  replacement: (content, node, options) => {
    const parent = node.parentNode;
    let prefix = `${options.bulletListMarker} `;
    if (parent.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start'));
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = `${(Number.isFinite(start) && start ? start : 1) + index}. `;
    }
    const body = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '\n')
      .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
    return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
  },
});

function longestBacktickRun(text) {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

/**
 * contenteditable inserts U+00A0 to keep spaces from collapsing while typing.
 * Those are an artefact of the editing surface, not something the author typed,
 * so they become ordinary spaces on the way back into the source.
 */
function tidy(markdown) {
  // Trailing double spaces are left alone: those are markdown hard breaks.
  return markdown.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Convert a run of preview blocks back to markdown source. */
export function blocksToMarkdown(elements) {
  const html = elements.map((el) => el.outerHTML).join('\n');
  return tidy(turndown.turndown(html));
}

/** Convert arbitrary pasted HTML to markdown. */
export function htmlToMarkdown(html) {
  return tidy(turndown.turndown(html));
}

const num = (el, attr) => {
  const value = Number(el?.getAttribute?.(attr));
  return Number.isFinite(value) ? value : null;
};

export class PreviewEditor {
  /**
   * @param {{ preview: import('./preview.js').Preview,
   *           editor: import('../editor/editor.js').Editor,
   *           onCommit?: () => void, onAtomicClick?: (line: number) => void }} deps
   */
  constructor({ preview, editor, onCommit, onAtomicClick }) {
    this.preview = preview;
    this.editor = editor;
    this.onCommit = onCommit;
    this.onAtomicClick = onAtomicClick;
    this.enabled = false;

    /** Source range touched since the last commit, or null. */
    this.pending = null;
    this.commitTimer = null;
    /** Set while we mutate the preview ourselves, so the observer stays quiet. */
    this.suspended = false;

    this.root = preview.root;
    this.#bind();
  }

  #bind() {
    this.root.addEventListener('input', () => {
      if (!this.enabled) return;
      this.#markDirtyFromSelection();
      this.#scheduleCommit();
    });

    this.root.addEventListener('blur', () => {
      if (this.enabled) this.commit({ rerender: true });
    });

    this.root.addEventListener('keydown', (event) => {
      if (!this.enabled) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      // The source pane owns the undo history — including the edits made here,
      // which are dispatched into it. A local contenteditable undo stack would
      // diverge from the document, so route the shortcut through CodeMirror.
      event.preventDefault();
      this.commit();
      if (isUndo) this.editor.undo();
      else this.editor.redo();
      this.#rerender(this.editor.getValue());
      this.onCommit?.();
    });

    this.root.addEventListener('paste', (event) => {
      if (!this.enabled) return;
      const html = event.clipboardData?.getData('text/html');
      const text = event.clipboardData?.getData('text/plain');
      if (!html && !text) return;
      event.preventDefault();
      // Normalize through markdown so pasted rich text lands as clean blocks.
      const markdown = html ? htmlToMarkdown(html) : text;
      this.suspended = true;
      document.execCommand('insertHTML', false, renderMarkdown(markdown));
      this.suspended = false;
      this.#markDirtyFromSelection();
      this.#scheduleCommit(0);
    });

    // Clicking a read-only block moves the source caret there instead.
    this.root.addEventListener('click', (event) => {
      if (!this.enabled) return;
      const atomic = event.target.closest?.('[contenteditable="false"]');
      if (!atomic) return;
      const block = this.#topLevel(atomic);
      const line = num(block, 'data-line');
      if (line !== null) this.onAtomicClick?.(line);
    });

    this.observer = new MutationObserver((records) => {
      if (!this.enabled || this.suspended) return;
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const start = num(node, 'data-line');
          const end = num(node, 'data-line-end');
          if (start !== null) this.#extend(start, end ?? start + 1);
        }
      }
    });
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    if (!enabled) this.commit({ rerender: true });
    this.enabled = enabled;
    this.preview.setEditable(enabled);
    if (enabled) {
      this.observer.observe(this.root, { childList: true, subtree: false });
    } else {
      this.observer.disconnect();
      this.pending = null;
    }
  }

  get dirty() {
    return this.pending !== null;
  }

  // ------------------------------------------------------------------ dirty

  #topLevel(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el.parentElement !== this.root) el = el.parentElement;
    return el && el.parentElement === this.root ? el : null;
  }

  #extend(start, end) {
    if (start === null) return;
    this.pending = this.pending
      ? { start: Math.min(this.pending.start, start), end: Math.max(this.pending.end, end) }
      : { start, end };
  }

  #markDirtyFromSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;
    const block = this.#topLevel(selection.anchorNode);
    if (!block) return;
    this.#markDirtyBlock(block);
  }

  #markDirtyBlock(block) {
    const start = num(block, 'data-line');
    if (start !== null) {
      this.#extend(start, num(block, 'data-line-end') ?? start + 1);
      return;
    }
    // A block created by the user (Enter in the preview) has no stamp yet;
    // borrow the range from its nearest stamped neighbours.
    let before = block.previousElementSibling;
    while (before && !before.hasAttribute('data-line')) before = before.previousElementSibling;
    let after = block.nextElementSibling;
    while (after && !after.hasAttribute('data-line')) after = after.nextElementSibling;

    const start2 = before ? num(before, 'data-line-end') : 0;
    const end2 = after ? num(after, 'data-line') : start2;
    this.#extend(start2 ?? 0, Math.max(end2 ?? 0, start2 ?? 0));
  }

  #scheduleCommit(delay = 350) {
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), delay);
  }

  // ----------------------------------------------------------------- commit

  /**
   * Write the touched blocks back into the markdown source.
   * @param {{ rerender?: boolean }} options
   */
  commit({ rerender = false } = {}) {
    clearTimeout(this.commitTimer);
    if (!this.pending) return false;

    const { start, end } = this.pending;
    this.pending = null;

    const run = this.#runFor(start, end);
    if (!run.length) {
      // Everything in the range was deleted: drop those source lines.
      this.editor.replaceLines(start, end, '');
      this.preview.markRendered(this.editor.getValue());
      this.preview.shiftLines(start, -(end - start));
      this.onCommit?.();
      return true;
    }

    const markdown = blocksToMarkdown(run);
    const changed = this.editor.replaceLines(start, end, markdown);
    const source = this.editor.getValue();
    // The preview already shows this content; suppress the echo re-render.
    this.preview.markRendered(source);

    if (changed) {
      const lineCount = markdown === '' ? 0 : markdown.split('\n').length;
      const delta = lineCount - (end - start);
      const restamped = this.#restamp(run, markdown, start);
      this.preview.shiftLines(end, delta, new Set(run));
      if (!restamped) rerender = true;
    }

    if (rerender) this.#rerender(source);
    this.onCommit?.();
    return changed;
  }

  /** The contiguous run of preview blocks covering source lines [start, end). */
  #runFor(start, end) {
    const children = Array.from(this.root.children);
    const inRange = [];
    for (let i = 0; i < children.length; i++) {
      const line = num(children[i], 'data-line');
      if (line !== null && line >= start && line < Math.max(end, start + 1)) inRange.push(i);
    }

    if (!inRange.length) {
      // Only unstamped (brand new) blocks: find them by their stamped neighbours.
      const first = children.findIndex((el) => {
        const line = num(el, 'data-line');
        return line !== null && line >= end;
      });
      const from = first === -1 ? children.length : first;
      const run = [];
      for (let i = from - 1; i >= 0 && !children[i].hasAttribute('data-line'); i--) run.unshift(children[i]);
      return run;
    }

    let low = inRange[0];
    let high = inRange[inRange.length - 1];
    while (low > 0 && !children[low - 1].hasAttribute('data-line')) low--;
    while (high < children.length - 1 && !children[high + 1].hasAttribute('data-line')) high++;
    return children.slice(low, high + 1);
  }

  /**
   * Re-stamp a committed run with its new source lines by rendering just that
   * markdown. Returns false when the block structure no longer lines up, in
   * which case the caller falls back to a full re-render.
   */
  #restamp(run, markdown, start) {
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(markdown);
    const rendered = Array.from(template.content.children);
    if (rendered.length !== run.length) return false;

    this.suspended = true;
    for (let i = 0; i < run.length; i++) {
      const line = num(rendered[i], 'data-line');
      const lineEnd = num(rendered[i], 'data-line-end');
      if (line === null) {
        run[i].removeAttribute('data-line');
        run[i].removeAttribute('data-line-end');
      } else {
        run[i].setAttribute('data-line', String(line + start));
        run[i].setAttribute('data-line-end', String((lineEnd ?? line + 1) + start));
      }
    }
    this.suspended = false;
    return true;
  }

  /** Full re-render that puts the caret back where the user left it. */
  #rerender(source) {
    const caret = this.#saveCaret();
    this.suspended = true;
    this.preview.invalidate();
    this.preview.render(source);
    this.preview.syncAtomic();
    this.suspended = false;
    if (caret) this.#restoreCaret(caret);
  }

  #saveCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!this.root.contains(range.startContainer)) return null;
    const block = this.#topLevel(range.startContainer);
    if (!block) return null;
    const measure = document.createRange();
    measure.selectNodeContents(block);
    measure.setEnd(range.startContainer, range.startOffset);
    return {
      index: Array.prototype.indexOf.call(this.root.children, block),
      offset: measure.toString().length,
    };
  }

  #restoreCaret({ index, offset }) {
    const block = this.root.children[index];
    if (!block) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    let last = null;
    while (node) {
      if (remaining <= node.data.length) {
        this.#setCaret(node, remaining);
        return;
      }
      remaining -= node.data.length;
      last = node;
      node = walker.nextNode();
    }
    if (last) this.#setCaret(last, last.data.length);
    else this.#setCaret(block, 0);
  }

  #setCaret(node, offset) {
    const range = document.createRange();
    range.setStart(node, Math.min(offset, node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length));
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

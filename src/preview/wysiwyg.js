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

// Task checkboxes are UI controls with no textual HTML content. Put their
// Markdown marker back before converting an edited list item to source.
turndown.addRule('taskCheckbox', {
  filter: (node) => node.nodeName === 'INPUT' && node.classList?.contains('task-checkbox'),
  replacement: (_content, node) => {
    // The rendered checkbox is already followed by the space that separates it
    // from the item text; supply one only when the DOM has lost it.
    const next = node.nextSibling;
    const spaced = next?.nodeType === Node.TEXT_NODE && /^[\s\u00a0]/.test(next.data);
    return `[${node.checked ? 'x' : ' '}]${spaced ? '' : ' '}`;
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
  return markdown.replace(/[\u200b\u00a0]/g, (char) => char === '\u00a0' ? ' ' : '')
    // ...but a line holding nothing except quote markers has no text to break.
    .replace(/^((?:[ \t]*>)+)[ \t]+$/gm, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A block with nothing in it — typically the empty paragraph or list item that
 * pressing Enter leaves behind. It is an editing affordance, not content: it has
 * no Markdown counterpart, so it must never be written back to the source.
 */
export function isBlankBlock(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (/^(HR|TABLE|PRE|IMG|IFRAME|VIDEO)$/.test(el.tagName)) return false;
  if (el.querySelector('img, hr, input, table, pre, .math, .raw-html')) return false;
  return !el.textContent.replace(/[\u200b\u00a0\s]/g, '');
}

/** Blocks whose text is prose the editing surface may have padded. */
const TEXT_BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|DL)$/;

/**
 * Serialize a block for conversion, without the editing artefacts that have no
 * business in the source: the empty list item the user is still typing into, and
 * the non-breaking space Chromium inserts when a block starts with a space.
 * Both are cleaned on a clone, so the live DOM — and the caret inside it — is
 * left exactly as the user left it.
 */
function prunedHtml(el) {
  if (!TEXT_BLOCK.test(el.tagName)) return el.outerHTML;
  const clone = el.cloneNode(true);

  // Indenting an item makes Chromium put the new list beside its parent item
  // rather than inside it. Markdown nesting is expressed by containment, so the
  // stray list is moved into the item it was indented under.
  for (const nested of clone.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol')) {
    if (nested.previousElementSibling?.tagName === 'LI') {
      nested.previousElementSibling.appendChild(nested);
    }
  }

  const lists = [clone, ...clone.querySelectorAll('ul, ol')].filter((node) => /^(UL|OL)$/.test(node.tagName));
  for (const list of lists.reverse()) {
    while (list.lastElementChild?.tagName === 'LI' && isBlankBlock(list.lastElementChild)) {
      list.lastElementChild.remove();
    }
  }

  const first = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT).nextNode();
  // Four of these would turn the block into an indented code block on the way
  // back in, so a leading run is always dropped, never just normalized.
  if (first) first.data = first.data.replace(/^[\u00a0\s]+/, '');
  return clone.outerHTML;
}

/**
 * Convert a run of preview blocks back to markdown source. Blank blocks are
 * skipped: Markdown has no way to spell an empty paragraph, and emitting one
 * would write a line of stray whitespace for every Enter the user pressed.
 */
export function blocksToMarkdown(elements) {
  const html = elements.filter((el) => !isBlankBlock(el)).map((el) => prunedHtml(el)).join('\n');
  return tidy(turndown.turndown(html));
}

/** Convert arbitrary pasted HTML to markdown. */
export function htmlToMarkdown(html) {
  return tidy(turndown.turndown(html));
}

/** Everything the input rule below treats as "this text has become markup". */
const MARKUP_SELECTOR =
  'h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,dl,hr,strong,em,s,del,mark,code,a,img,sub,sup,.math,.footnotes,.task-checkbox,.raw-html';

/** Delimiters whose meaning changes when one more of the same is typed. */
const DELIMITERS = '*_~=`^$';

function firstMarkupKind(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const el = template.content.querySelector(MARKUP_SELECTOR);
  return el ? `${el.tagName}.${el.className}` : null;
}

/**
 * `**bold**` is typed through `**bold*`, which on its own is a complete
 * `*emphasis*`. Rendering it at that keystroke would strand the user inside an
 * <em> halfway through the word, so hold the input rule back while one more of
 * the same delimiter would produce different markup.
 */
function stillTypingDelimiter(text) {
  const last = text.at(-1);
  if (!last || !DELIMITERS.includes(last)) return false;
  const now = firstMarkupKind(renderMarkdown(text));
  if (!now) return false;
  const extended = firstMarkupKind(renderMarkdown(text + last));
  return extended !== null && extended !== now;
}

/**
 * Tags the browser uses to carry the formatting of wherever the caret came from
 * into the block it just created: <font>/<span style> after a code span, <i> or
 * <b> after emphasis. The renderer only ever emits <em>, <strong> and <code>,
 * so one of these around the caret was put there by the editing surface.
 */
const INHERITED_FORMATTING = new Set(['FONT', 'B', 'I', 'U', 'STRIKE']);

const isInheritedFormatting = (el) =>
  INHERITED_FORMATTING.has(el.tagName) ||
  (el.tagName === 'SPAN' && el.attributes.length === 1 && el.hasAttribute('style'));

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
    /**
     * Source range of the blocks deleted since the last commit, or null. Those
     * lines have no block left to convert, so the commit has to be told about
     * them separately or they would survive in the source.
     */
    this.removed = null;
    this.commitTimer = null;
    this.selectAllPending = false;
    /** Set while we mutate the preview ourselves, so the observer stays quiet. */
    this.suspended = false;

    this.root = preview.root;
    this.#bind();
  }

  #bind() {
    this.root.addEventListener('beforeinput', (event) => {
      if (!this.enabled || !event.inputType.startsWith('delete')) return;
      if (!this.selectAllPending && !this.#selectionCoversDocument()) return;
      event.preventDefault();
      this.selectAllPending = false;
      this.#clearDocument();
    });

    this.root.addEventListener('input', () => {
      if (!this.enabled) return;
      this.#applyMarkdownInputRule();
      this.#ensureEditingBlock();
      this.#markDirtyFromSelection();
      this.#scheduleCommit();
    });

    this.root.addEventListener('blur', () => {
      if (!this.enabled) return;
      // Switching windows blurs the preview too, and that is not the user
      // leaving what they were writing: re-rendering there would rebuild the
      // block the caret sits in, so coming back would land them somewhere else.
      // Tidying the DOM is only worth it once focus has really moved on.
      this.commit({ rerender: document.hasFocus() });
    });

    this.root.addEventListener('keydown', (event) => {
      if (!this.enabled) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        this.selectAllPending = true;
        return;
      }
      if (!['Shift', 'Meta', 'Control', 'Alt', 'Backspace', 'Delete'].includes(event.key)) {
        this.selectAllPending = false;
      }
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey) {
        // Tab must never walk the focus out of the document: the resulting blur
        // commits and re-renders, throwing away whatever block was being typed.
        event.preventDefault();
        this.#indentListItem(event.shiftKey);
        return;
      }
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
          if (start === null) continue;
          this.#extend(start, end ?? start + 1);
          this.removed = this.removed
            ? { start: Math.min(this.removed.start, start), end: Math.max(this.removed.end, end ?? start + 1) }
            : { start, end: end ?? start + 1 };
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
      this.#ensureEditingBlock();
    } else {
      this.observer.disconnect();
      this.pending = null;
      this.removed = null;
    }
  }

  get dirty() {
    return this.pending !== null;
  }

  /** Focus the preview and put the caret in its first editable block. */
  focus() {
    if (!this.enabled) return;
    this.#ensureEditingBlock();
    this.root.focus();
    const first = this.root.firstElementChild;
    if (first && !first.textContent) this.#setCaret(first, 0);
  }

  // ------------------------------------------------------------------ dirty

  #topLevel(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el.parentElement !== this.root) el = el.parentElement;
    return el && el.parentElement === this.root ? el : null;
  }

  #selectionCoversDocument() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const selected = selection.toString().replace(/[\s\u200b\u00a0]/g, '');
    const documentText = this.root.textContent.replace(/[\s\u200b\u00a0]/g, '');
    return documentText !== '' && selected === documentText;
  }

  /**
   * Tab nests the current list item under the one above it (Shift+Tab lifts it
   * back out). Outside a list there is nothing sensible for Tab to insert —
   * a literal tab at the start of a block would read back as an indented code
   * block — so it is simply swallowed.
   */
  #indentListItem(outdent) {
    const anchor = window.getSelection()?.anchorNode;
    const el = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    if (!el?.closest?.('li') || !this.#topLevel(el)) return;
    this.suspended = true;
    document.execCommand(outdent ? 'outdent' : 'indent', false);
    this.suspended = false;
    this.#markDirtyFromSelection();
    this.#scheduleCommit();
  }

  /** Keep an empty document as one editable plain paragraph. */
  #ensureEditingBlock() {
    if (!this.root.children.length && !this.root.textContent.trim()) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      this.suspended = true;
      this.root.replaceChildren(paragraph);
      this.suspended = false;
      this.#setCaret(paragraph, 0);
      return;
    }

    // Code, math and raw HTML are read-only here, so a document ending in one
    // leaves the user with nowhere to put the caret and no way to write another
    // paragraph. An empty paragraph at the end is that place; being blank, it
    // never reaches the source.
    const last = this.root.lastElementChild;
    if (last?.getAttribute('contenteditable') !== 'false') return;
    const pad = document.createElement('p');
    pad.appendChild(document.createElement('br'));
    this.suspended = true;
    this.root.appendChild(pad);
    this.suspended = false;
  }

  /** Browser list editing leaves an empty list marker after Select All/Delete. */
  #clearDocument() {
    clearTimeout(this.commitTimer);
    this.pending = null;
    this.removed = null;
    const lineCount = Math.max(1, this.editor.getValue().split('\n').length);
    this.editor.replaceLines(0, lineCount, '');
    this.preview.markRendered(this.editor.getValue());

    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    this.suspended = true;
    this.root.replaceChildren(paragraph);
    this.suspended = false;
    this.root.focus();
    this.#setCaret(paragraph, 0);
    this.onCommit?.();
  }

  /**
   * Give familiar Markdown prefixes immediate visual meaning while editing the
   * rendered pane. Chromium starts an empty contenteditable with either a DIV
   * or a direct text node, so normalize that first and then apply block rules.
   */
  #applyMarkdownInputRule() {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode || !this.root.contains(selection.anchorNode)) return;

    // Cmd/Ctrl+A followed by Delete removes every child of contenteditable and
    // leaves the selection on the root itself. Always recreate one ordinary
    // paragraph so typing can continue and the previous block style is gone.
    if (selection.anchorNode === this.root && !this.root.textContent.trim()) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      this.suspended = true;
      this.root.replaceChildren(paragraph);
      this.suspended = false;
      this.#setCaret(paragraph, 0);
      return;
    }

    let block = this.#topLevel(selection.anchorNode);
    if (!block && selection.anchorNode.parentNode === this.root) {
      const paragraph = document.createElement('p');
      this.suspended = true;
      this.root.insertBefore(paragraph, selection.anchorNode);
      paragraph.appendChild(selection.anchorNode);
      this.suspended = false;
      block = paragraph;
    }
    if (!block) return;
    this.#stripInheritedFormatting(block);

    // Deleting the last character from a styled block should also delete the
    // style. Otherwise an empty heading remains an H1–H6 forever because the
    // browser only edits its contents, not the element itself. This mirrors
    // block editors such as Notion: an emptied heading becomes a plain block.
    if (/^(?:H[1-6]|UL|OL|BLOCKQUOTE|DL)$/.test(block.tagName) &&
        !block.textContent.replace(/[\u200b\u00a0]/g, '').trim()) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      for (const attr of ['data-line', 'data-line-end']) {
        if (block.hasAttribute(attr)) paragraph.setAttribute(attr, block.getAttribute(attr));
      }
      this.suspended = true;
      block.replaceWith(paragraph);
      this.suspended = false;
      this.#setCaret(paragraph, 0);
      return;
    }

    // Once a complete piece of Markdown is present, run it through the exact
    // same renderer as the source pane. This covers inline code, emphasis,
    // links, images, math, mark/sub/sup, quotes, rules, definitions and the
    // other syntax supported by renderer.js instead of maintaining a second
    // partial grammar here.
    const plainHost = /^(P|DIV)$/.test(block.tagName) && !block.querySelector('*:not(br)');
    const plainText = block.textContent.replace(/\u00a0/g, ' ');
    const inputRulePrefix = /^(?:#{1,6}|[-*+>]|\d+[.)]) ?$/.test(plainText);
    const listItem = selection.anchorNode.parentElement?.closest?.('li');
    // Exact block prefixes belong to the input rules below. Rendering `- ` as
    // arbitrary Markdown here would put the caret after UL instead of in LI,
    // and subsequent typing could create duplicate sibling lists.
    if (plainHost && !inputRulePrefix && !stillTypingDelimiter(plainText) &&
        this.#renderCompletedMarkdown(block, plainText)) return;
    // Once a block holds any markup it is no longer a plain host, but the text
    // being typed after that markup still deserves the rules — otherwise the
    // first `code` or **bold** in a paragraph is the only one that ever renders.
    const anchor = selection.anchorNode;
    if (!plainHost && anchor.nodeType === Node.TEXT_NODE && anchor.parentElement === block &&
        !stillTypingDelimiter(anchor.data.replace(/ /g, ' ')) &&
        this.#renderCompletedInline(block, anchor)) return;
    if (listItem && !listItem.querySelector('*:not(br)')) {
      const list = listItem.closest('ul, ol');
      const itemText = listItem.textContent.replace(/\u00a0/g, ' ');
      // The half-typed delimiter is held back here too: `**b*` inside an item
      // is a complete emphasis, and rendering it stranded the closing `*` as
      // literal text that the source then kept as `\**b\**`.
      if (list && list.parentElement === this.root && !stillTypingDelimiter(itemText)) {
        const index = Array.prototype.indexOf.call(list.children, listItem);
        const marker = list.tagName === 'OL' ? `${Number(list.start || 1) + index}. ` : '- ';
        if (this.#renderCompletedListItem(listItem, marker + itemText)) return;
      }
    }

    if (!/^(P|DIV)$/.test(block.tagName)) return;

    const text = plainText;
    const heading = /^(#{1,6}) $/.exec(text);
    const bullet = /^(?:[-*+]) $/.test(text);
    const ordered = /^(\d+)[.)] $/.exec(text);
    const quote = /^> $/.test(text);
    if (!heading && !bullet && !ordered && !quote) return;

    let replacement;
    let caretHost;
    if (heading) {
      replacement = document.createElement(`h${heading[1].length}`);
      caretHost = replacement;
    } else if (quote) {
      // A quote holds paragraphs, so the caret belongs in one — typing straight
      // into the BLOCKQUOTE would leave a bare text node that Enter then splits
      // into siblings the converter cannot read back as quoted lines.
      replacement = document.createElement('blockquote');
      caretHost = document.createElement('p');
      replacement.appendChild(caretHost);
    } else {
      replacement = document.createElement(ordered ? 'ol' : 'ul');
      if (ordered && Number(ordered[1]) !== 1) replacement.start = Number(ordered[1]);
      caretHost = document.createElement('li');
      replacement.appendChild(caretHost);
    }
    caretHost.appendChild(document.createElement('br'));
    for (const attr of ['data-line', 'data-line-end']) {
      if (block.hasAttribute(attr)) replacement.setAttribute(attr, block.getAttribute(attr));
    }
    this.suspended = true;
    block.replaceWith(replacement);
    this.suspended = false;
    this.#setCaret(caretHost, 0);
  }

  /**
   * Drop the formatting the browser wrapped around the caret. Leaving a list
   * item that ended in `code` hands the new block a <font> wrapper, and one
   * that ended in *emphasis* hands it an <i>: the first stops the block being a
   * plain host, so no input rule below ever fires and the backticks reach the
   * source escaped; the second turns anything typed there into italics that the
   * author never asked for.
   *
   * Only a caret sitting under nothing but these wrappers is cleaned. Real
   * markup between it and the block — an <em> the author is typing inside — is
   * left exactly where it is.
   */
  #stripInheritedFormatting(block) {
    const anchor = window.getSelection()?.anchorNode;
    if (!anchor) return false;
    const wrappers = [];
    let el = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
    for (; el && el !== block; el = el.parentElement) {
      if (!isInheritedFormatting(el)) return false;
      wrappers.push(el);
    }
    if (!el || !wrappers.length) return false;

    const caret = this.#saveCaret();
    this.suspended = true;
    for (const wrapper of wrappers) wrapper.replaceWith(...wrapper.childNodes);
    this.suspended = false;
    if (caret) this.#restoreCaret(caret);
    return true;
  }

  /** Replace a plain editing block when `source` has acquired real markup. */
  #renderCompletedMarkdown(block, source) {
    if (!source.trim()) return false;
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(source);
    const rendered = Array.from(template.content.children);
    if (!rendered.length || !template.content.querySelector(MARKUP_SELECTOR)) return false;

    const start = block.getAttribute('data-line');
    const end = block.getAttribute('data-line-end');
    if (start !== null) rendered[0].setAttribute('data-line', start);
    if (end !== null) rendered[rendered.length - 1].setAttribute('data-line-end', end);

    this.suspended = true;
    block.replaceWith(...rendered);
    this.preview.resolveAssets(this.root);
    this.preview.syncAtomic();
    this.suspended = false;

    const caretHost = [...rendered].reverse().find((el) => el.getAttribute('contenteditable') !== 'false') ?? rendered.at(-1);
    // Inline Markdown is complete once its closing delimiter is typed. Put the
    // caret after the rendered inline node so subsequent text is plain instead
    // of becoming trapped inside <code>, <strong>, <em>, etc. Block syntax
    // (notably headings) keeps the caret inside its newly created block.
    if (rendered.length === 1 && /^(P|DIV)$/.test(caretHost.tagName)) {
      // Chromium inherits the formatting of the preceding inline element even
      // when a range is placed at the parent's final child boundary. A
      // zero-width, plain text node gives the caret a real unstyled home. It is
      // stripped by tidy() and never reaches the Markdown source.
      const exit = document.createTextNode('\u200b');
      caretHost.appendChild(exit);
      this.#setCaret(exit, 1);
    } else {
      const walker = document.createTreeWalker(caretHost, NodeFilter.SHOW_TEXT);
      let last = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
      this.#setCaret(last ?? caretHost, last?.data.length ?? caretHost.childNodes.length);
    }
    return true;
  }

  /**
   * Render the one text node the caret is in, leaving the markup already in the
   * block alone. Only inline syntax qualifies: anything that parses as a block
   * belongs to the block rules, which own the whole element.
   */
  #renderCompletedInline(block, node) {
    const source = node.data.replace(/ /g, ' ');
    if (!source.trim()) return false;
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(source);
    const paragraph = template.content.children.length === 1 &&
      template.content.firstElementChild.tagName === 'P' ? template.content.firstElementChild : null;
    if (!paragraph || !paragraph.querySelector('strong,em,s,del,mark,code,a,img,sub,sup,.math')) return false;

    const inserted = Array.from(paragraph.childNodes);
    this.suspended = true;
    node.replaceWith(...inserted);
    this.preview.resolveAssets(block);
    this.preview.syncAtomic();
    this.suspended = false;

    // Same as above: a zero-width plain text node keeps what follows from being
    // absorbed into the formatting that was just closed.
    const exit = document.createTextNode('\u200b');
    inserted[inserted.length - 1].after(exit);
    this.#setCaret(exit, 1);
    return true;
  }

  /** Apply inline/task notation inside one list item without replacing siblings. */
  #renderCompletedListItem(listItem, source) {
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(source);
    const renderedItem = template.content.querySelector('li');
    if (!renderedItem || !renderedItem.querySelector(
      'strong,em,s,del,mark,code,a,img,sub,sup,.math,.task-checkbox',
    )) return false;

    this.suspended = true;
    listItem.replaceChildren(...Array.from(renderedItem.childNodes));
    this.preview.resolveAssets(listItem);
    this.preview.syncAtomic();
    this.suspended = false;

    const walker = document.createTreeWalker(listItem, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
    this.#setCaret(last ?? listItem, last?.data.length ?? listItem.childNodes.length);
    return true;
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

    const hint = this.pending;
    const gone = this.removed;
    this.pending = null;
    this.removed = null;

    const run = this.#runFor(hint.start, hint.end);
    if (!run.length) {
      // Everything in the range was deleted: drop those source lines.
      const range = gone ?? hint;
      this.editor.replaceLines(range.start, range.end, '');
      this.preview.markRendered(this.editor.getValue());
      this.preview.shiftLines(range.start, -(range.end - range.start));
      this.onCommit?.();
      return true;
    }

    // The lines to replace come from the blocks themselves, never from the hint:
    // the hint is only good enough to locate them, and splicing a run into a
    // range narrower than the lines it came from duplicates the difference.
    const { start, end } = this.#spanFor(run, gone);
    // markdown-it counts the blank line after a block as part of it, so a span
    // routinely ends in one. The converter never emits trailing blanks, and
    // dropping them here would glue the next block onto the one just edited.
    const blanks = /\n+$/.exec(this.editor.getLines(start, end))?.[0].length ?? 0;
    const converted = blocksToMarkdown(run);
    const markdown = converted && blanks ? converted + '\n'.repeat(blanks) : converted;
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
    const stamped = (i) => children[i].hasAttribute('data-line');
    const inRange = [];
    for (let i = 0; i < children.length; i++) {
      const line = num(children[i], 'data-line');
      if (line !== null && line >= start && line < Math.max(end, start + 1)) inRange.push(i);
    }

    let low;
    let high;
    if (inRange.length) {
      low = inRange[0];
      high = inRange[inRange.length - 1];
    } else {
      // Only unstamped (brand new) blocks: find them by their stamped neighbours.
      const first = children.findIndex((el) => {
        const line = num(el, 'data-line');
        return line !== null && line >= end;
      });
      const from = first === -1 ? children.length : first;
      // Nothing new either: the blocks that held these lines are gone.
      if (from === 0 || stamped(from - 1)) return [];
      low = from - 1;
      high = from - 1;
    }

    while (low > 0 && !stamped(low - 1)) low--;
    while (high < children.length - 1 && !stamped(high + 1)) high++;
    // A run of nothing but new blocks owns no source lines to splice into. Anchor
    // it to a stamped neighbour, which also keeps the blank line that separates
    // the new block from the one it was typed after.
    if (!children.slice(low, high + 1).some((el) => el.hasAttribute('data-line'))) {
      if (low > 0) low--;
      else if (high < children.length - 1) high++;
    }
    return children.slice(low, high + 1);
  }

  /**
   * The source lines a run of blocks was rendered from. Blocks the user just
   * created carry no stamp and contribute nothing: their markdown is spliced in
   * between the lines of their stamped neighbours in the same run.
   */
  #spanFor(run, removed = null) {
    let start = removed ? removed.start : null;
    let end = removed ? removed.end : null;
    for (const el of run) {
      const line = num(el, 'data-line');
      if (line === null) continue;
      const lineEnd = num(el, 'data-line-end') ?? line + 1;
      start = start === null ? line : Math.min(start, line);
      end = end === null ? lineEnd : Math.max(end, lineEnd);
    }
    // No stamp anywhere in the run means the preview has none at all (a brand
    // new or emptied document), so the run is the whole document.
    if (start === null) return { start: 0, end: Math.max(1, this.editor.lineCount()) };
    return { start, end };
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
    // Blank blocks — the paragraph Enter just created, or one the user has
    // emptied — are deliberately absent from the markdown, so they are not a
    // structure mismatch. Pairing around them is what lets the caret stay in the
    // block the user is typing in instead of being swept away by a re-render.
    const content = run.filter((el) => !isBlankBlock(el));
    if (rendered.length !== content.length) return false;

    this.suspended = true;
    let next = 0;
    for (const block of run) {
      const source = isBlankBlock(block) ? null : rendered[next++];
      const line = source ? num(source, 'data-line') : null;
      const lineEnd = source ? num(source, 'data-line-end') : null;
      if (line === null) {
        block.removeAttribute('data-line');
        block.removeAttribute('data-line-end');
      } else {
        block.setAttribute('data-line', String(line + start));
        block.setAttribute('data-line-end', String((lineEnd ?? line + 1) + start));
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
    // An emptied document gets its caret from the fresh paragraph below; there
    // is nothing left to restore it to.
    const emptied = !this.root.children.length;
    if (this.enabled) this.#ensureEditingBlock();
    if (caret && !emptied) this.#restoreCaret(caret);
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
    // A re-render can leave fewer blocks than there were. Landing at the end of
    // the document beats leaving the selection detached, where the browser drops
    // the caret at an arbitrary earlier position.
    const block = this.root.children[Math.min(index, this.root.children.length - 1)];
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

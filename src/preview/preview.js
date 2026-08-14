import { renderMarkdown } from '../markdown/renderer.js';

/** Elements that are never editable inside the preview. */
const ATOMIC_SELECTOR = '.math, pre, .raw-html, .footnotes, hr, table thead';

/**
 * The rendered document. Owns the preview DOM: rendering, patching it in place
 * (so scroll position and caret survive a re-render), resolving relative asset
 * paths, and the block <-> source-line index used for scroll sync and for
 * editing in the preview.
 */
export class Preview {
  /**
   * @param {HTMLElement} root the `.markdown-body` article
   * @param {HTMLElement} scroller the scrolling pane around it
   */
  constructor(root, scroller) {
    this.root = root;
    this.scroller = scroller;
    this.basePath = null;
    this.lastSource = null;
    /**
     * Called right after the DOM has been patched. An editor sitting on top of
     * the preview needs to know which changes to its blocks were its user's and
     * which were ours.
     * @type {(() => void)|null}
     */
    this.onPatch = null;
  }

  setBasePath(filePath) {
    if (this.basePath === filePath) return;
    this.basePath = filePath;
    this.resolveAssets(this.root);
  }

  /** Render `source` into the preview, patching only what actually changed. */
  render(source) {
    if (source === this.lastSource) return;
    this.lastSource = source;

    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(source);
    // Assets are resolved while the fragment is still inert, so the browser
    // never fires a request for the unresolved relative URL.
    this.resolveAssets(template.content);
    patchChildren(this.root, Array.from(template.content.children));
    this.onPatch?.();
  }

  /** Force the next render() call to do work even if the source is unchanged. */
  invalidate() {
    this.lastSource = null;
  }

  /**
   * Declare that the DOM already reflects `source`. Used after an in-preview
   * edit, where the user's own typing produced the DOM and re-rendering would
   * only destroy their caret.
   */
  markRendered(source) {
    this.lastSource = source;
  }

  /** Rewrite relative `src`/`href` so local files load from disk. */
  resolveAssets(scope) {
    const resolve = window.jmd?.resolveAsset;
    for (const img of scope.querySelectorAll('img')) {
      const original = img.getAttribute('data-src') ?? img.getAttribute('src') ?? '';
      img.setAttribute('data-src', original);
      if (!original || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(original)) continue;
      const resolved = resolve ? resolve(this.basePath, decodeURI(original)) : null;
      if (resolved) img.setAttribute('src', resolved);
      else img.removeAttribute('src');
    }
    for (const link of scope.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (/^https?:/i.test(href)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noreferrer noopener');
      }
    }
  }

  // ------------------------------------------------------------- editing mode

  /**
   * Toggle in-preview editing. Atomic blocks (math, code, raw HTML) stay
   * read-only: round-tripping their markup through HTML is lossy, so they are
   * edited in the source pane instead.
   */
  setEditable(enabled) {
    this.root.contentEditable = enabled ? 'true' : 'false';
    this.root.spellcheck = enabled;
    this.root.classList.toggle('is-editable', enabled);
    this.syncAtomic();
  }

  get editable() {
    return this.root.contentEditable === 'true';
  }

  /** Keep atomic blocks non-editable after every render. */
  syncAtomic() {
    const editable = this.editable;
    for (const el of this.root.querySelectorAll(ATOMIC_SELECTOR)) {
      if (editable) el.setAttribute('contenteditable', 'false');
      else el.removeAttribute('contenteditable');
    }
  }

  // ------------------------------------------------------------- line index

  /** Top-level blocks that carry a source range, in document order. */
  mappedBlocks() {
    return Array.from(this.root.children).filter((el) => el.hasAttribute('data-line'));
  }

  /**
   * Offset every source line stamp at or after `fromLine` by `delta`.
   * `exclude` holds blocks that were just re-stamped with their new, already
   * correct positions — shifting those again would corrupt the index.
   */
  shiftLines(fromLine, delta, exclude = null) {
    if (!delta) return;
    for (const el of this.root.children) {
      if (exclude?.has(el)) continue;
      if (!el.hasAttribute('data-line')) continue;
      const start = Number(el.getAttribute('data-line'));
      if (Number.isFinite(start) && start >= fromLine) {
        el.setAttribute('data-line', String(start + delta));
      }
      const end = Number(el.getAttribute('data-line-end'));
      if (Number.isFinite(end) && end > fromLine) el.setAttribute('data-line-end', String(end + delta));
    }
  }

  /** Viewport-relative offset of a block within the scroller. */
  #offsetOf(el) {
    return el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
  }

  /**
   * Fractional source line currently at the top of the preview viewport.
   * @returns {number}
   */
  topLine() {
    const blocks = this.mappedBlocks();
    if (!blocks.length) return 0;
    const top = this.scroller.scrollTop;

    let previous = null;
    for (const el of blocks) {
      const start = this.#offsetOf(el);
      const height = el.offsetHeight;
      if (start + height > top) {
        const line = Number(el.getAttribute('data-line'));
        const endLine = Number(el.getAttribute('data-line-end'));
        if (start >= top) {
          // Between blocks: interpolate across the gap.
          if (!previous) return line * (top / Math.max(start, 1));
          const prevEnd = this.#offsetOf(previous) + previous.offsetHeight;
          const prevEndLine = Number(previous.getAttribute('data-line-end'));
          const gap = Math.max(start - prevEnd, 1);
          const ratio = Math.min(1, Math.max(0, (top - prevEnd) / gap));
          return prevEndLine + (line - prevEndLine) * ratio;
        }
        const ratio = height > 0 ? (top - start) / height : 0;
        return line + (endLine - line) * Math.min(1, Math.max(0, ratio));
      }
      previous = el;
    }
    const last = blocks[blocks.length - 1];
    return Number(last.getAttribute('data-line-end'));
  }

  /** Scroll so that `line` (fractional, 0-based) sits at the top. */
  scrollToLine(line) {
    const blocks = this.mappedBlocks();
    if (!blocks.length) return;

    let previous = null;
    for (const el of blocks) {
      const start = Number(el.getAttribute('data-line'));
      const end = Number(el.getAttribute('data-line-end'));
      if (end > line) {
        const offset = this.#offsetOf(el);
        if (start > line) {
          // The line lives in the blank space before this block.
          if (!previous) {
            this.scroller.scrollTop = offset * (line / Math.max(start, 1));
            return;
          }
          const prevEnd = this.#offsetOf(previous) + previous.offsetHeight;
          const prevEndLine = Number(previous.getAttribute('data-line-end'));
          const span = Math.max(start - prevEndLine, 1);
          const ratio = Math.min(1, Math.max(0, (line - prevEndLine) / span));
          this.scroller.scrollTop = prevEnd + (offset - prevEnd) * ratio;
          return;
        }
        const ratio = end > start ? (line - start) / (end - start) : 0;
        this.scroller.scrollTop = offset + el.offsetHeight * Math.min(1, Math.max(0, ratio));
        return;
      }
      previous = el;
    }
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

}

/**
 * Replace `parent`'s children with `next`, reusing nodes whose markup is
 * unchanged. Trimming the common prefix and suffix first keeps a single-block
 * edit from rewriting the whole document, which is what preserves the caret,
 * scroll position, and image decode state between keystrokes.
 */
function patchChildren(parent, next) {
  const current = Array.from(parent.children);

  let head = 0;
  while (head < current.length && head < next.length && current[head].outerHTML === next[head].outerHTML) {
    head++;
  }
  let tail = 0;
  while (
    tail < current.length - head &&
    tail < next.length - head &&
    current[current.length - 1 - tail].outerHTML === next[next.length - 1 - tail].outerHTML
  ) {
    tail++;
  }

  const removeCount = current.length - head - tail;
  const insert = next.slice(head, next.length - tail);

  // Reuse the overlap in the changed middle so a text-only edit mutates one node.
  const reuse = Math.min(removeCount, insert.length);
  for (let i = 0; i < reuse; i++) {
    current[head + i].replaceWith(insert[i]);
  }
  for (let i = reuse; i < removeCount; i++) {
    current[head + i].remove();
  }
  if (insert.length > reuse) {
    const anchor = current[current.length - tail] ?? null;
    const fragment = document.createDocumentFragment();
    for (let i = reuse; i < insert.length; i++) fragment.appendChild(insert[i]);
    parent.insertBefore(fragment, anchor);
  }
}

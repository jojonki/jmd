/**
 * Find-in-preview.
 *
 * Matches are painted with the CSS Custom Highlight API instead of being
 * wrapped in `<mark>`: the preview is contenteditable and is patched in place
 * on every keystroke, so anything that mutated its DOM would fight both the
 * caret and the renderer. Highlights live beside the DOM and are simply
 * recomputed whenever the document changes.
 */

const MATCHES = 'jmd-find';
const CURRENT = 'jmd-find-current';

/** Tags that do not break a run of text, so a match may span them. */
const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN',
  'EM', 'I', 'IMG', 'INS', 'KBD', 'LABEL', 'MARK', 'OUTPUT', 'Q', 'RP', 'RT',
  'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U',
  'VAR', 'WBR',
]);

const supported = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';

export class PreviewFind {
  /**
   * @param {HTMLElement} root the rendered `.markdown-body`
   * @param {HTMLElement} pane the scrolling pane around it
   * @param {{ bar: HTMLElement, input: HTMLInputElement, count: HTMLElement,
   *           prev: HTMLElement, next: HTMLElement, close: HTMLElement }} ui
   * @param {{ onClose?: () => void }} [handlers]
   */
  constructor(root, pane, ui, handlers = {}) {
    this.root = root;
    this.pane = pane;
    this.ui = ui;
    this.handlers = handlers;
    this.open = false;
    /** @type {Range[]} */
    this.ranges = [];
    this.index = 0;

    ui.input.addEventListener('input', () => this.#search({ keepIndex: false }));
    ui.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    });
    ui.prev.addEventListener('click', () => this.step(-1));
    ui.next.addEventListener('click', () => this.step(1));
    ui.close.addEventListener('click', () => this.hide());
  }

  /** Open the bar, seeding it from the current selection when there is one. */
  show() {
    const selected = window.getSelection?.()?.toString().trim();
    if (selected && !selected.includes('\n') && selected.length <= 120) {
      this.ui.input.value = selected;
    }
    this.open = true;
    this.ui.bar.hidden = false;
    this.ui.input.focus();
    this.ui.input.select();
    this.#search({ keepIndex: false });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.ui.bar.hidden = true;
    this.ranges = [];
    this.#paint();
    this.handlers.onClose?.();
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  /**
   * Recompute the matches against the current DOM. Called after every render,
   * because a re-render leaves the previous ranges pointing at detached nodes.
   */
  reindex() {
    if (!this.open) return;
    this.#search({ keepIndex: true });
  }

  /** Move to the next (`1`) or previous (`-1`) match. */
  step(delta) {
    if (!this.ranges.length) return;
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.#paint();
    this.#reveal();
    this.#report();
  }

  // ---------------------------------------------------------------- internals

  #search({ keepIndex }) {
    const query = this.ui.input.value.replace(/[\r\n]+/g, ' ');
    const previous = keepIndex ? this.index : 0;
    this.ranges = query ? this.#match(query) : [];
    this.index = Math.min(previous, Math.max(this.ranges.length - 1, 0));
    this.#paint();
    if (!keepIndex) this.#reveal();
    this.#report();
  }

  /**
   * Flatten the preview into one string, remembering which text node each
   * offset came from, then turn every case-insensitive hit into a Range.
   * @returns {Range[]}
   */
  #match(query) {
    const { nodes, starts, text } = this.#collect();
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    const out = [];
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      const from = locate(starts, at, false);
      const to = locate(starts, at + needle.length, true);
      if (from < 0 || to < 0) continue;
      range.setStart(nodes[from], at - starts[from]);
      range.setEnd(nodes[to], at + needle.length - starts[to]);
      out.push(range);
    }
    return out;
  }

  /**
   * Every text node in the preview, concatenated. A newline is written between
   * two nodes that sit in different blocks so a query never matches across the
   * end of one paragraph and the start of the next.
   */
  #collect() {
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    const starts = [];
    let text = '';
    let block = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue) continue;
      const owner = blockOf(node, this.root);
      if (block && owner !== block) text += '\n';
      block = owner;
      starts.push(text.length);
      nodes.push(node);
      text += node.nodeValue;
    }
    return { nodes, starts, text };
  }

  #paint() {
    if (!supported) return;
    if (!this.ranges.length) {
      CSS.highlights.delete(MATCHES);
      CSS.highlights.delete(CURRENT);
      return;
    }
    const rest = this.ranges.filter((_, i) => i !== this.index);
    if (rest.length) CSS.highlights.set(MATCHES, new Highlight(...rest));
    else CSS.highlights.delete(MATCHES);
    CSS.highlights.set(CURRENT, new Highlight(this.ranges[this.index]));
  }

  /** Scroll the current match into the pane, leaving a little room around it. */
  #reveal() {
    const range = this.ranges[this.index];
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const view = this.pane.getBoundingClientRect();
    const margin = 72;
    if (rect.top < view.top + margin) this.pane.scrollTop += rect.top - view.top - margin;
    else if (rect.bottom > view.bottom - margin) this.pane.scrollTop += rect.bottom - view.bottom + margin;
  }

  #report() {
    const total = this.ranges.length;
    this.ui.count.textContent = total ? `${this.index + 1}/${total}` : this.ui.input.value ? '0/0' : '';
    this.ui.bar.classList.toggle('is-empty', !!this.ui.input.value && !total);
    this.ui.prev.disabled = !total;
    this.ui.next.disabled = !total;
  }
}

/** The nearest ancestor of `node` that is not purely inline. */
function blockOf(node, root) {
  let el = node.parentElement;
  while (el && el !== root && INLINE.has(el.tagName)) el = el.parentElement;
  return el ?? root;
}

/**
 * Index of the text node covering `offset`.
 * @param {number[]} starts node start offsets, ascending
 * @param {boolean} end treat the offset as exclusive, so a match ending exactly
 *   on a node boundary stays inside the node it actually covered
 */
function locate(starts, offset, end) {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (end ? starts[mid] < offset : starts[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

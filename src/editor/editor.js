import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import {
  markdown,
  markdownLanguage,
  insertNewlineContinueMarkupCommand,
  deleteMarkupBackward,
} from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { vimExtension, watchVim } from './vim.js';

/**
 * Markdown syntax colouring. Every colour is a CSS variable so switching the
 * app theme restyles the editor without rebuilding the EditorState.
 */
const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--syn-heading)', fontWeight: '700', fontSize: '1.4em' },
  { tag: t.heading2, color: 'var(--syn-heading)', fontWeight: '700', fontSize: '1.25em' },
  { tag: t.heading3, color: 'var(--syn-heading)', fontWeight: '700', fontSize: '1.1em' },
  { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: t.strong, color: 'var(--syn-strong)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-muted)' },
  { tag: t.link, color: 'var(--syn-link)' },
  { tag: t.url, color: 'var(--syn-link)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--syn-code)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  // `t.list` is not the bullet — the markdown grammar tags every descendant of
  // a list with it, so this colours the item's prose. It stays a hair off the
  // body colour: enough to see at a glance that a block parsed as a list, not
  // enough to read as a different kind of text. The marker itself is what
  // carries the signal, and it keeps the louder `--syn-marker` below.
  { tag: t.list, color: 'var(--syn-list)' },
  { tag: t.processingInstruction, color: 'var(--syn-marker)' },
  // A task box is markdown's only `atom`, and `atom` descends from `keyword` —
  // left alone, `[x]` picks up the keyword red and shouts next to the bullet
  // it belongs to. It is a list marker, so it is coloured as one.
  { tag: t.atom, color: 'var(--syn-marker)' },
  { tag: t.contentSeparator, color: 'var(--syn-marker)' },
  // Fenced code contents
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: t.comment, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className], color: 'var(--syn-type)' },
]);

/** A line holding a list marker and nothing else, task box included. */
const EMPTY_ITEM = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?$/;

/**
 * Enter on an empty top-level list item leaves the list — and leaves a blank
 * line behind it, because without one the next thing typed is a lazy
 * continuation that Markdown folds straight back into the item above.
 * Nested items fall through to the command below, which outdents them a level.
 */
const leaveListOnEmptyItem = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty) return false;
  // Not inside a code fence, where `- ` is code rather than a list marker.
  if (!markdownLanguage.isActiveAt(state, range.head, -1) &&
      !markdownLanguage.isActiveAt(state, range.head, 1)) return false;

  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !EMPTY_ITEM.test(line.text)) return false;

  // The separating blank line is only needed after an item that has text; a
  // list that starts empty has nothing above to be absorbed into.
  const previous = line.number > 1 ? state.doc.line(line.number - 1) : null;
  const insert = previous && /\S/.test(previous.text) ? '\n' : '';
  dispatch(state.update({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    userEvent: 'input',
    scrollIntoView: true,
  }));
  return true;
};

const continueMarkup = insertNewlineContinueMarkupCommand({
  // Enter on an empty item means "I am done with this list", never "make the
  // list loose by pushing a blank line above the marker I am standing on".
  nonTightLists: false,
});

const markdownEnter = (target) => leaveListOnEmptyItem(target) || continueMarkup(target);

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size)',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: 'var(--editor-line-height)',
    padding: '0',
    overflowX: 'hidden',
  },
  // Left-aligned, not centred in the pane. `--measure` still caps how long a
  // line gets before it wraps, but the slack that a wide window leaves over is
  // all given to the right — centring it would push the text away from its own
  // line numbers, which is the one thing no code editor does.
  '.cm-content': {
    padding: 'var(--pane-pad-y) 0',
    maxWidth: 'var(--measure)',
    margin: '0',
    caretColor: 'var(--caret)',
  },
  // The gutter-to-text gap belongs to the line, not to the content box around
  // it: a multi-line selection is drawn from the content's left edge plus the
  // *line's* padding, so padding the content instead would paint that gap for
  // every line after the first — a band of colour where there is no text and
  // not even a space character. Same width either way, since `.cm-content` is
  // border-box and its max-width counts the padding.
  '.cm-line': { padding: '0 var(--pane-pad-x) 0 var(--editor-text-gap)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)',
  },
  // CodeMirror's own base theme paints the *focused* selection through a
  // selector specific enough to beat the line above — and it reaches for its
  // light palette, because this theme is one set of variables rather than a
  // light/dark pair. Every dark skin used to select text into a near-white
  // band. Matching the base rule's shape hands the colour back to the theme.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--fg-faint)',
    border: 'none',
    padding: '0 var(--editor-gutter-gap) 0 var(--editor-gutter-pad)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--match)' },
  // Syntax colouring would otherwise decide how legible a match is; the theme's
  // selection foreground is picked to sit on these bands.
  '.cm-searchMatch': {
    backgroundColor: 'var(--match)',
    color: 'var(--selection-fg)',
    outline: '1px solid var(--border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--match-active)' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--fg)',
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  // CodeMirror's own base theme paints `.cm-button` with a fixed light-grey
  // gradient (`backgroundImage`, not `backgroundColor`) unless the editor is
  // flagged dark — which this app never does, since it's one token set for
  // every skin rather than a light/dark pair. Left alone, that gradient sits
  // opaque on top of the `backgroundColor` above, so on dark themes the fg
  // token used for the label text (light) lands on a light background too.
  '.cm-panel button': {
    backgroundImage: 'none',
  },
  '.cm-panel button:hover': {
    backgroundColor: 'var(--bg-elevated)',
    borderColor: 'var(--border-strong)',
  },
  '.cm-panel button:active': {
    backgroundImage: 'none',
    backgroundColor: 'var(--active-line)',
  },
  '.cm-textfield': { backgroundColor: 'var(--bg)' },
});

export class Editor {
  /**
   * @param {HTMLElement} parent
   * @param {{ onChange?: (doc: string) => void, onScroll?: () => void,
   *           onCursor?: (state: EditorState) => void,
   *           onVim?: (status: import('./vim.js').VimStatus|null) => void }} options
   */
  constructor(parent, options = {}) {
    this.options = options;
    /** Suppresses onChange while we apply a programmatic edit. */
    this.applyingRemoteEdit = false;
    /** Vim mode, off unless the settings turn it on. */
    this.vim = false;
    /** Holds the vim extension so it can be swapped without rebuilding a state. */
    this.vimCompartment = new Compartment();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !this.applyingRemoteEdit) {
        options.onChange?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        options.onCursor?.(update.state);
      }
    });

    /**
     * Shared by every document: each tab owns an EditorState built from these,
     * which is what gives a tab its own undo history and selection.
     */
    this.extensions = [
      lineNumbers(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlightStyle),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
      // The markdown keymap the line above would have installed, with Enter
      // routed through the list handling in markdownEnter. Same precedence it
      // uses, so these still win over the default Enter and Backspace.
      Prec.high(keymap.of([
        { key: 'Enter', run: markdownEnter },
        { key: 'Backspace', run: deleteMarkupBackward },
      ])),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      baseTheme,
      updateListener,
    ];

    this.view = new EditorView({ parent, state: this.createState('') });

    this.view.scrollDOM.addEventListener('scroll', () => options.onScroll?.(), { passive: true });
  }

  get dom() {
    return this.view.dom;
  }

  /** A detached state for a document the view is not currently showing. */
  createState(text) {
    return EditorState.create({
      doc: text,
      extensions: [this.vimCompartment.of(vimExtension(this.vim)), ...this.extensions],
    });
  }

  /** Swap the whole document — history, selection and all — into the view. */
  setState(state) {
    this.applyingRemoteEdit = true;
    // A tab parked while vim mode was in the other setting still carries that
    // configuration; reconciling on the way in is what spares every other tab
    // from being walked whenever the setting changes.
    this.view.setState(this.#withVim(state));
    this.applyingRemoteEdit = false;
    this.#reportVim();
    // A whole-state swap goes around the update listener, so the caret readout
    // would otherwise keep showing the position in the tab we just left.
    this.options.onCursor?.(this.view.state);
  }

  /**
   * Turn vim mode on or off for the live document. Documents parked in other
   * tabs are reconfigured as they come back through `setState`.
   */
  setVim(enabled) {
    if (this.vim === !!enabled) return;
    this.vim = !!enabled;
    this.view.dispatch({ effects: this.vimCompartment.reconfigure(vimExtension(this.vim)) });
    this.#reportVim();
  }

  /** The same state, configured for the vim setting in force. */
  #withVim(state) {
    return state.update({
      effects: this.vimCompartment.reconfigure(vimExtension(this.vim)),
    }).state;
  }

  /** Keep whoever is showing the mode in step with the editor. */
  #reportVim() {
    if (!this.options.onVim) return;
    if (this.vim) watchVim(this.view, this.options.onVim);
    else this.options.onVim(null);
  }

  getValue() {
    return this.view.state.doc.toString();
  }

  /** Replace the whole document without reporting a user edit. */
  setValue(text, { silent = false } = {}) {
    this.applyingRemoteEdit = silent;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
      scrollIntoView: false,
    });
    this.applyingRemoteEdit = false;
  }

  /**
   * Replace source lines [startLine, endLine) with `text`. Used to write an
   * in-preview edit back into the source of truth.
   * @returns {boolean} whether anything changed
   */
  replaceLines(startLine, endLine, text, { silent = true } = {}) {
    const doc = this.view.state.doc;
    const total = doc.lines;
    const from = doc.line(Math.min(Math.max(startLine + 1, 1), total)).from;
    const lastLine = Math.min(Math.max(endLine, 1), total);
    const to = doc.line(lastLine).to;
    if (doc.sliceString(from, to) === text) return false;

    this.applyingRemoteEdit = silent;
    this.view.dispatch({ changes: { from, to, insert: text }, scrollIntoView: false });
    this.applyingRemoteEdit = false;
    return true;
  }

  /** Number of source lines (an empty document still has one). */
  lineCount() {
    return this.view.state.doc.lines;
  }

  /** Text of source lines [startLine, endLine). */
  getLines(startLine, endLine) {
    const doc = this.view.state.doc;
    const total = doc.lines;
    if (startLine >= total) return '';
    const from = doc.line(Math.min(startLine + 1, total)).from;
    const to = doc.line(Math.min(Math.max(endLine, 1), total)).to;
    return doc.sliceString(from, to);
  }

  focus() {
    this.view.focus();
  }

  /**
   * The source pane owns the undo history for the whole app, including edits
   * that were made in the preview — those are dispatched through here too.
   */
  undo() {
    return undo(this.view);
  }

  redo() {
    return redo(this.view);
  }

  openSearch() {
    this.focus();
    openSearchPanel(this.view);
  }

  /**
   * Document height (CodeMirror's own coordinate space) currently sitting at
   * the top edge of the viewport.
   */
  #viewportTopHeight() {
    return this.view.scrollDOM.getBoundingClientRect().top - this.view.documentTop;
  }

  /** 0-based line index at the top of the viewport, with a fractional part. */
  topLine() {
    const height = Math.max(0, this.#viewportTopHeight());
    const block = this.view.lineBlockAtHeight(height);
    const line = this.view.state.doc.lineAt(block.from).number - 1;
    const progress = block.height > 0
      ? Math.min(1, Math.max(0, (height - block.top) / block.height))
      : 0;
    return line + progress;
  }

  /** Scroll so that the given (fractional, 0-based) line sits at the top. */
  scrollToLine(line) {
    const doc = this.view.state.doc;
    const index = Math.min(Math.max(Math.floor(line) + 1, 1), doc.lines);
    const block = this.view.lineBlockAt(doc.line(index).from);
    const target = block.top + block.height * (line - Math.floor(line));
    this.view.scrollDOM.scrollTop += target - this.#viewportTopHeight();
  }

  /** Put the caret on a 0-based line and reveal it. */
  goToLine(line) {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line + 1, 1), doc.lines));
    this.view.dispatch({
      selection: { anchor: target.from },
      scrollIntoView: true,
    });
  }

  /**
   * Caret position for the status bar, 1-based the way editors report it, plus
   * how much text is selected (0 when the caret is a bare cursor). Counted in
   * characters, so a tab is one column rather than a tab stop.
   * @param {EditorState} [state] the state being reported on, when it is not
   *   yet the one in the view — an update listener sees the new state first.
   */
  cursor(state = this.view.state) {
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const selected = state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
    return { line: line.number, column: range.head - line.from + 1, selected };
  }

  stats() {
    const text = this.getValue();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { chars: text.length, words, lines: this.view.state.doc.lines };
  }
}

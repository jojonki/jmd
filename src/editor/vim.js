/**
 * Vim mode for the source pane.
 *
 * The editing model comes from @replit/codemirror-vim — the CodeMirror 6 port
 * of the vim keymap CodeMirror has shipped for years, so counts, operators,
 * motions, text objects, registers, marks, macros, `/` search and the `:` line
 * behave the way they do in vim. What lives here is the wiring around it: the
 * precedence that lets normal mode win over the app's own markdown keys, the
 * mode reading the status bar shows, and the handful of ex commands that only
 * mean anything inside jmd.
 */
import { Prec } from '@codemirror/state';
import { vim, getCM, Vim } from '@replit/codemirror-vim';

/**
 * Vim reads keys through a view plugin rather than through a keymap, and every
 * keymap in the editor — the markdown Enter and Backspace included — is
 * dispatched by one handler sitting at default precedence. Lifting the plugin
 * above that handler is what keeps Enter a motion in normal mode while leaving
 * it a list continuation in insert mode, where vim passes the key on.
 *
 * Frozen at module level so reconfiguring a state that already has vim on is a
 * no-op rather than a teardown and a rebuild.
 */
const VIM = /*@__PURE__*/ Prec.highest(vim());
const OFF = [];

/** The extension a vim compartment holds in either state. */
export const vimExtension = (enabled) => (enabled ? VIM : OFF);

// ------------------------------------------------------------------- status

/**
 * What the status bar shows: the mode, plus the keys of a command that has been
 * started but not yet finished (`d2` on the way to `d2w`), the way vim's own
 * `showcmd` does.
 * @typedef {{ kind: string, label: string, pending: string }} VimStatus
 */

/** @returns {VimStatus|null} */
function readStatus(cm) {
  const state = cm?.state?.vim;
  if (!state) return null;
  let kind = 'normal';
  let label = 'NORMAL';
  if (state.insertMode) {
    kind = cm.state.overwrite ? 'replace' : 'insert';
    label = kind === 'replace' ? 'REPLACE' : 'INSERT';
  } else if (state.visualMode) {
    kind = 'visual';
    label = state.visualLine ? 'V-LINE' : state.visualBlock ? 'V-BLOCK' : 'VISUAL';
  }
  return { kind, label, pending: state.status || '' };
}

/** Marks a CodeMirror shim we have already subscribed to. */
const WATCHED = Symbol('jmd.vimWatched');

/**
 * Report the vim mode of `view` whenever it changes, and once immediately.
 *
 * Safe — and necessary — to call again after a reconfiguration or a document
 * swap: both rebuild the view plugin, and with it the CodeMirror shim these
 * events hang off.
 * @param {import('@codemirror/view').EditorView} view
 * @param {(status: VimStatus|null) => void} report
 */
export function watchVim(view, report) {
  const cm = getCM(view);
  if (!cm) {
    report(null);
    return;
  }
  const push = () => report(readStatus(cm));
  if (!cm[WATCHED]) {
    cm[WATCHED] = true;
    // `vim-keypress` covers the half-typed commands the other two miss.
    for (const event of ['vim-mode-change', 'vim-keypress', 'vim-command-done']) cm.on(event, push);
  }
  push();
}

// -------------------------------------------------------------- ex commands

/**
 * Teach the `:` line the commands that act on a jmd document. The vim engine is
 * a singleton shared by every editor in the window, so this runs once.
 *
 * @param {{ write: (arg: string|null) => void, writeQuit: () => void,
 *           quit: (force: boolean) => void, quitAll: (force: boolean) => void }} handlers
 */
export function defineVimCommands(handlers) {
  // `:q!` parses as the command `q` with an argument of `!`.
  const parse = (params) => {
    const rest = (params.argString ?? '').trim();
    return { force: rest.startsWith('!'), arg: rest.replace(/^!\s*/, '') || null };
  };
  const ex = (name, prefix, run) => Vim.defineEx(name, prefix, (_cm, params) => run(parse(params)));

  ex('write', 'w', ({ arg }) => handlers.write(arg));
  ex('wq', 'wq', () => handlers.writeQuit());
  ex('xit', 'x', () => handlers.writeQuit());
  ex('quit', 'q', ({ force }) => handlers.quit(force));
  ex('qall', 'qa', ({ force }) => handlers.quitAll(force));
}

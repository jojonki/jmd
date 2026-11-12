/**
 * KaTeX and highlight.js are a third of the renderer's bundle, and a blank
 * document — what jmd opens with — needs neither. Keeping them out of the
 * startup bundle is what lets the first window paint without parsing them.
 *
 * Until a library arrives, the renderer prints its input as plain text: the
 * TeX source, the unhighlighted code. Loading it then tells the listeners, who
 * upgrade what is already on screen in place (see `upgradeRendered`).
 */

export const loaded = { hljs: null, katex: null };

const listeners = new Set();
let highlighter = null;
let math = null;

const settle = (promise, what) =>
  promise
    .then(() => {
      for (const listener of listeners) listener();
    })
    .catch((error) => {
      // Rendering falls back to plain text, which is still readable.
      console.error(`jmd: could not load ${what}`, error);
    });

export function loadHighlighter() {
  highlighter ??= settle(
    import('highlight.js/lib/common').then((module) => {
      loaded.hljs = module.default;
    }),
    'highlight.js',
  );
  return highlighter;
}

export function loadMath() {
  math ??= settle(
    Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
      loaded.katex = module.default;
    }),
    'KaTeX',
  );
  return math;
}

export const loadAll = () => Promise.all([loadHighlighter(), loadMath()]);

/** Called each time a library arrives, after it can be used. */
export function onLoaded(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

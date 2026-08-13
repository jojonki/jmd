/**
 * Drives the real app: renders a fixture document, exercises in-preview
 * editing, and writes screenshots. Run with `npm run smoke`.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.JMD_SMOKE_OUT || path.join(__dirname, '..', 'shots');
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`shot: ${file}`);
}

module.exports = async function run(win, { app }) {
  const wc = win.webContents;
  await new Promise((resolve) => {
    if (!wc.isLoading()) resolve();
    else wc.once('did-finish-load', resolve);
  });
  await wait(1200);

  const js = (code) => wc.executeJavaScript(code, true);

  try {
    // ---------------------------------------------------------- rendering
    const rendered = await js(`(() => {
      const p = document.getElementById('preview');
      return {
        katex: p.querySelectorAll('.katex').length,
        mathBlocks: p.querySelectorAll('.math-block').length,
        tables: p.querySelectorAll('table').length,
        tasks: p.querySelectorAll('.task-checkbox').length,
        footnotes: p.querySelectorAll('.footnotes').length,
        code: p.querySelectorAll('pre code .hljs-keyword').length,
        mark: p.querySelectorAll('mark').length,
        sub: p.querySelectorAll('sub').length,
        mapped: p.querySelectorAll('[data-line]').length,
        errors: p.querySelectorAll('.math-error').length,
      };
    })()`);
    console.log('rendered:', JSON.stringify(rendered));
    check('KaTeX math renders', rendered.katex >= 2);
    check('display math block', rendered.mathBlocks >= 1);
    check('no math errors', rendered.errors === 0);
    check('table renders', rendered.tables >= 1);
    check('task list renders', rendered.tasks >= 2);
    check('footnotes render', rendered.footnotes >= 1);
    check('code highlighted', rendered.code >= 1);
    check('==mark== renders', rendered.mark >= 1);
    check('H~2~O subscript', rendered.sub >= 1);
    check('blocks carry source lines', rendered.mapped >= 10);

    await shot(win, '01-welcome-github');

    // ------------------------------------------------------------- themes
    for (const theme of ['nord', 'paper', 'dracula']) {
      await js(`document.getElementById('theme-select').value='${theme}';
                document.getElementById('theme-select').dispatchEvent(new Event('change'));`);
      await wait(250);
      await shot(win, `02-theme-${theme}`);
    }
    const themeApplied = await js(`document.documentElement.dataset.theme`);
    check('theme switching works', themeApplied === 'dracula', themeApplied);
    await js(`document.getElementById('theme-select').value='github';
              document.getElementById('theme-select').dispatchEvent(new Event('change'));`);
    await wait(200);

    // ------------------------------------------------- live source editing
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: '# Title\\n\\nHello **world** and $a^2+b^2=c^2$.\\n\\n- one\\n- two\\n' } });
    })()`);
    await wait(400);
    const live = await js(`(() => {
      const p = document.getElementById('preview');
      return { h1: p.querySelector('h1')?.textContent, strong: !!p.querySelector('strong'),
               inlineMath: p.querySelectorAll('.math-inline').length, li: p.querySelectorAll('li').length };
    })()`);
    check('live preview updates', live.h1 === 'Title' && live.strong, JSON.stringify(live));
    check('inline math renders', live.inlineMath === 1);

    // ------------------------------------------------- edit in the preview
    await js(`window.__jmd.setWysiwyg(true)`);
    await wait(300);
    const editable = await js(`document.getElementById('preview').contentEditable`);
    check('preview becomes editable', editable === 'true', editable);
    const atomic = await js(`document.querySelectorAll('#preview [contenteditable="false"]').length`);
    check('math/code blocks stay atomic', atomic >= 1, String(atomic));

    // Type into the first paragraph, then let the commit fire.
    await js(`(() => {
      const p = document.querySelector('#preview p');
      const text = p.firstChild;
      const range = document.createRange();
      range.setStart(text, 5);
      range.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' there');
      return p.textContent;
    })()`);
    await wait(700);
    const afterEdit = await js(`window.__jmd.editor.getValue()`);
    check('preview edit reaches the source', afterEdit.includes('Hello there **world**'),
      JSON.stringify(afterEdit.split('\n')[2]));
    check('untouched lines keep their formatting', afterEdit.includes('- one\n- two'),
      JSON.stringify(afterEdit));
    check('math survives the round trip', afterEdit.includes('$a^2+b^2=c^2$'));

    // Heading edit in the preview.
    await js(`(() => {
      const h = document.querySelector('#preview h1');
      const range = document.createRange();
      range.selectNodeContents(h);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' Edited');
    })()`);
    await wait(700);
    const afterHeading = await js(`window.__jmd.editor.getValue()`);
    check('heading edit writes back as markdown', afterHeading.startsWith('# Title Edited'),
      JSON.stringify(afterHeading.split('\n')[0]));

    // New paragraph created with Enter inside the preview.
    await js(`(() => {
      const paras = document.querySelectorAll('#preview p');
      const p = paras[0];
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertParagraph');
      document.execCommand('insertText', false, 'A brand new paragraph.');
    })()`);
    await wait(800);
    const afterEnter = await js(`window.__jmd.editor.getValue()`);
    check('new preview paragraph appears in source', afterEnter.includes('A brand new paragraph.'),
      JSON.stringify(afterEnter));
    check('list still intact after insert', afterEnter.includes('- one'), JSON.stringify(afterEnter));

    // Editing a list item in the preview must not reflow the sibling items.
    await js(`(() => {
      const li = document.querySelectorAll('#preview li')[1];
      const range = document.createRange();
      range.selectNodeContents(li);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' point');
    })()`);
    await wait(700);
    const afterList = await js(`window.__jmd.editor.getValue()`);
    check('list item edit writes back', /- two point/.test(afterList), JSON.stringify(afterList));
    check('sibling list item untouched', /- one\n/.test(afterList), JSON.stringify(afterList));

    // Undo inside the preview must roll back through the source history.
    await js(`(() => {
      document.getElementById('preview').dispatchEvent(new KeyboardEvent('keydown',
        { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
    })()`);
    await wait(500);
    const afterUndo = await js(`window.__jmd.editor.getValue()`);
    check('undo in preview rolls back the source', !/- two point/.test(afterUndo),
      JSON.stringify(afterUndo));
    const previewMatchesSource = await js(`(() => {
      const p = document.getElementById('preview');
      return [...p.querySelectorAll('li')].map(li => li.textContent).join('|');
    })()`);
    check('preview redraws after undo', !previewMatchesSource.includes('two point'),
      previewMatchesSource);

    await shot(win, '03-preview-editing');

    await js(`window.__jmd.setWysiwyg(false)`);
    await wait(300);

    // ------------------------------------------------------- task checkbox
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: '- [ ] alpha\\n- [x] beta\\n' } });
    })()`);
    await wait(400);
    await js(`document.querySelector('#preview .task-checkbox').click()`);
    await wait(300);
    const tasks = await js(`window.__jmd.editor.getValue()`);
    check('checkbox toggles the source', tasks.startsWith('- [x] alpha'), JSON.stringify(tasks));

    // ---------------------------------------------------------- edge cases
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: 'Costs $5 and $6 today.\\n\\n$$\\n\\\\frac{1}{2}\\n$$\\n\\n\\\\$escaped\\\\$\\n' } });
    })()`);
    await wait(400);
    const edge = await js(`(() => {
      const p = document.getElementById('preview');
      return { text: p.querySelector('p').textContent,
               inline: p.querySelectorAll('.math-inline').length,
               block: p.querySelectorAll('.math-block').length };
    })()`);
    check('prices are not treated as math', edge.text.includes('$5') && edge.inline === 0,
      JSON.stringify(edge));
    check('display math still parses', edge.block === 1, JSON.stringify(edge));

    // Malformed math must not break the render.
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: 'Broken $\\\\frac{1}{$ math\\n\\nAfter.\\n' } });
    })()`);
    await wait(400);
    const broken = await js(`(() => {
      const p = document.getElementById('preview');
      return { errors: p.querySelectorAll('.math-error').length, paras: p.querySelectorAll('p').length };
    })()`);
    check('invalid math degrades gracefully', broken.paras === 2, JSON.stringify(broken));

    // XSS must not survive sanitisation.
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: '<img src=x onerror="window.__pwned=1">\\n\\n<script>window.__pwned=2<\\/script>\\n\\n[x](javascript:window.__pwned=3)\\n' } });
    })()`);
    await wait(500);
    const xss = await js(`(() => ({
      pwned: window.__pwned ?? null,
      onerror: document.querySelectorAll('#preview [onerror]').length,
      scripts: document.querySelectorAll('#preview script').length,
      jsHref: [...document.querySelectorAll('#preview a')].filter(a => (a.getAttribute('href')||'').startsWith('javascript:')).length,
    }))()`);
    check('html is sanitised', xss.pwned === null && xss.onerror === 0 && xss.scripts === 0 && xss.jsHref === 0,
      JSON.stringify(xss));

    // ------------------------------------------------------- local images
    const imgDir = path.join(OUT, 'imgtest');
    fs.mkdirSync(path.join(imgDir, 'images'), { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKklEQVR42u3NMQEAAAgDoC252LDh' +
      'CyGgs5MKAAAAAAAAAAAAAAAAAADwZQF1cwGkVKzHrgAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(imgDir, 'images', 'dot.png'), png);
    const docPath = path.join(imgDir, 'doc.md');
    fs.writeFileSync(docPath, '# Image test\n\n![dot](./images/dot.png)\n');
    await js(`(async () => {
      const { path: p, content } = await window.jmd.readFile(${JSON.stringify(docPath)});
      window.__jmd.loadDocument(p, content);
    })()`);
    await wait(900);
    const image = await js(`(() => {
      const img = document.querySelector('#preview img');
      return { src: img?.getAttribute('src') ?? null, w: img?.naturalWidth ?? 0 };
    })()`);
    check('relative image loads from disk', image.w === 32, JSON.stringify(image));
    await shot(win, '04-local-image');

    // ---------------------------------------------------------- scroll sync
    await js(`(() => {
      const view = window.__jmd.editor.view;
      const lines = [];
      for (let i = 0; i < 60; i++) lines.push('## Section ' + i, '', 'Body text for section ' + i + '.', '');
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lines.join('\\n') } });
    })()`);
    await wait(500);
    const sync = await js(`(async () => {
      const pane = document.getElementById('preview-pane');
      // Claim the editor as the scroll leader the way a real user would.
      document.getElementById('editor-pane').dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      window.__jmd.editor.scrollToLine(120);
      await new Promise(r => setTimeout(r, 200));
      const top = pane.scrollTop;
      const el = [...document.querySelectorAll('#preview [data-line]')]
        .find(e => e.getBoundingClientRect().top >= pane.getBoundingClientRect().top - 4);
      return { top, line: el?.getAttribute('data-line') ?? null };
    })()`);
    check('editor scroll drives the preview', Number(sync.line) >= 112 && Number(sync.line) <= 128,
      JSON.stringify(sync));
    await shot(win, '05-scroll-sync');

    const reverse = await js(`(async () => {
      const pane = document.getElementById('preview-pane');
      pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      pane.scrollTop = 1000;
      await new Promise(r => setTimeout(r, 250));
      return { editorLine: window.__jmd.editor.topLine(), previewLine: window.__jmd.preview.topLine() };
    })()`);
    check('preview scroll drives the editor',
      Math.abs(reverse.editorLine - reverse.previewLine) < 3, JSON.stringify(reverse));

    // ------------------------------------------------------- save & export
    const savePath = path.join(OUT, 'imgtest', 'saved.md');
    if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
    await js(`(async () => {
      window.__jmd.loadDocument(${JSON.stringify(savePath)}, '# Saved doc\\n');
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: '\\nBody line.\\n' } });
      await window.__jmd.save();
    })()`);
    await wait(600);
    const savedText = fs.existsSync(savePath) ? fs.readFileSync(savePath, 'utf8') : '';
    check('save writes the document to disk', savedText.includes('Body line.'), JSON.stringify(savedText));
    const clean = await js(`(() => ({
      dirtyHidden: document.getElementById('dirty-dot').hidden,
      name: document.getElementById('doc-name').textContent,
    }))()`);
    check('saving clears the dirty marker', clean.dirtyHidden === true && clean.name === 'saved.md',
      JSON.stringify(clean));

    const exported = await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length,
        insert: '# Export\\n\\n$x^2$ and **bold**\\n' } });
      return new Promise(r => setTimeout(() => {
        r(window.__jmd.buildExportHtml());
      }, 400));
    })()`);
    check('html export is a standalone document',
      exported.includes('<!doctype html>') && exported.includes('data-theme=') &&
      exported.includes('katex') && exported.includes('--bg:'),
      `${exported.length} bytes`);
  } catch (error) {
    check('smoke run completed without exception', false, String(error && error.stack ? error.stack : error));
  }

  const consoleErrors = await js(`window.__jmdErrors ?? []`).catch(() => []);
  check('no uncaught renderer errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length ? 1 : 0);
};

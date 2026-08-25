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
  const nativeText = async (text) => {
    for (const char of text) {
      wc.sendInputEvent({ type: 'char', keyCode: char });
      await wait(20);
    }
  };
  const nativeKey = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(40);
  };
  /** Synthesized key events only reach a focused window; take it back first. */
  const grabFocus = () => {
    app.focus({ steal: true });
    win.focus();
    wc.focus();
  };
  const focusEmptyPreview = () => (grabFocus(), js(`(() => {
    window.__jmd.loadDocument(null, '');
    const root = document.getElementById('preview');
    root.focus();
    const p = root.firstElementChild;
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    window.__previewInputTrace = [];
    root.addEventListener('input', event => queueMicrotask(() => {
      window.__previewInputTrace.push({ inputType: event.inputType, data: event.data, html: root.innerHTML });
    }), { once: false });
  })()`));

  try {
    const initialViewState = await js(`(() => ({
      editing: window.__jmd.previewEditor.enabled,
      layout: document.getElementById('status-layout').textContent,
      mode: document.getElementById('status-mode').textContent,
      inStatusbar: document.getElementById('status-layout').parentElement.id === 'statusbar',
      previewFocused: document.activeElement === document.getElementById('preview'),
      editingBlock: document.querySelector('#preview > p')?.tagName,
    }))()`);
    check('view state is shown in the status bar',
      initialViewState.inStatusbar && ['Editor', 'Split', 'Preview'].includes(initialViewState.layout),
      JSON.stringify(initialViewState));
    check('preview editing is enabled by default',
      initialViewState.editing && initialViewState.mode === 'Preview editing',
      JSON.stringify(initialViewState));
    check('an untitled document starts focused at a plain preview paragraph',
      initialViewState.previewFocused && initialViewState.editingBlock === 'P',
      JSON.stringify(initialViewState));

    const startsBlank = await js(`window.__jmd.editor.getValue() === '' &&
      document.getElementById('preview').textContent === ''`);
    check('a normal launch starts with an empty document', startsBlank);
    const gutters = await js(`document.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length`);
    check('the editor shows line numbers', gutters >= 1, String(gutters));

    // Markdown prefixes typed into the rendered pane act like input rules.
    await focusEmptyPreview();
    await nativeText('# ');
    const headingRule = await js(`(() => ({
      tag: document.querySelector('#preview > :first-child')?.tagName,
      emptyBorder: getComputedStyle(document.querySelector('#preview > :first-child')).borderBottomColor,
      html: document.getElementById('preview').innerHTML,
      trace: window.__previewInputTrace,
    }))()`);
    await nativeText('Typed heading');
    await wait(600);
    const headingSource = await js(`window.__jmd.editor.getValue()`);
    check('typing # in Preview creates a heading without an empty underline',
      headingRule.tag === 'H1' && headingRule.emptyBorder === 'rgba(0, 0, 0, 0)' && headingSource === '# Typed heading',
      JSON.stringify({ headingRule, headingSource }));

    const styleCancellation = await js(`(async () => {
      window.__jmd.loadDocument(null, '# Typed heading');
      const root = document.getElementById('preview');
      const heading = root.querySelector('h1');
      heading.replaceChildren(document.createElement('br'));
      const range = document.createRange();
      range.setStart(heading, 0);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      heading.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      await new Promise(resolve => setTimeout(resolve, 450));
      return { tag: root.firstElementChild?.tagName, source: window.__jmd.editor.getValue() };
    })()`);
    check('deleting all heading text cancels the heading style',
      styleCancellation.tag === 'P' && styleCancellation.source === '', JSON.stringify(styleCancellation));

    const inlineCodeExit = await js(`(() => {
      window.__jmd.loadDocument(null, '');
      const root = document.getElementById('preview');
      const p = document.createElement('p');
      p.textContent = '\`code\`';
      root.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      p.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      document.execCommand('insertText', false, ' plain');
      return {
        html: root.firstElementChild?.innerHTML,
        code: root.querySelector('code')?.textContent,
        text: root.firstElementChild?.textContent,
      };
    })()`);
    await wait(600);
    const inlineCodeSource = await js(`window.__jmd.editor.getValue()`);
    check('closing backtick exits inline-code formatting',
      inlineCodeExit.code === 'code' && inlineCodeSource === '\`code\` plain',
      JSON.stringify({ ...inlineCodeExit, source: inlineCodeSource }));

    const deletionBehavior = await js(`(async () => {
      const root = document.getElementById('preview');
      const selectAllAndDelete = () => {
        root.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
      };

      window.__jmd.loadDocument(null, '# Delete me');
      selectAllAndDelete();
      await new Promise(resolve => setTimeout(resolve, 500));
      const heading = { tag: root.firstElementChild?.tagName, source: window.__jmd.editor.getValue() };

      window.__jmd.loadDocument(null, '\`Delete me\`');
      selectAllAndDelete();
      await new Promise(resolve => setTimeout(resolve, 500));
      const code = { tag: root.firstElementChild?.tagName, source: window.__jmd.editor.getValue() };

      document.execCommand('insertText', false, 'normal');
      await new Promise(resolve => setTimeout(resolve, 500));
      return {
        heading,
        code,
        resumedTag: root.firstElementChild?.tagName,
        resumedCode: !!root.querySelector('code'),
        resumedSource: window.__jmd.editor.getValue(),
      };
    })()`);
    check('select-all deletion resets heading and inline-code styles',
      deletionBehavior.heading.tag === 'P' && deletionBehavior.heading.source === '' &&
      deletionBehavior.code.tag === 'P' && deletionBehavior.code.source === '' &&
      deletionBehavior.resumedTag === 'P' && !deletionBehavior.resumedCode &&
      deletionBehavior.resumedSource === 'normal', JSON.stringify(deletionBehavior));

    await focusEmptyPreview();
    await nativeText('- ');
    const caretInItem = await js(`getSelection().anchorNode?.parentElement?.closest?.('li') != null ||
      getSelection().anchorNode?.closest?.('li') != null`);
    await nativeText('alpha');
    await nativeKey('Enter');
    await nativeText('beta');
    await wait(500);
    const afterTyping = await js(`(() => {
      const root = document.getElementById('preview');
      return {
        lists: root.querySelectorAll(':scope > ul').length,
        items: [...root.querySelectorAll(':scope > ul > li')].map(li => li.textContent),
        source: window.__jmd.editor.getValue(),
      };
    })()`);
    wc.selectAll();
    await nativeKey('Backspace');
    await wait(500);
    const afterDelete = await js(`(() => {
      const root = document.getElementById('preview');
      return {
        tag: root.firstElementChild?.tagName,
        children: root.children.length,
        text: root.textContent,
        source: window.__jmd.editor.getValue(),
      };
    })()`);
    const listEditing = { caretInItem, afterTyping, afterDelete };
    check('typing a two-item list creates one list without duplicated items',
      listEditing.caretInItem && listEditing.afterTyping.lists === 1 &&
      JSON.stringify(listEditing.afterTyping.items) === JSON.stringify(['alpha', 'beta']) &&
      listEditing.afterTyping.source === '- alpha\n- beta', JSON.stringify(listEditing));
    check('select-all deletion completely clears a list and returns to a paragraph',
      listEditing.afterDelete.tag === 'P' && listEditing.afterDelete.children === 1 &&
      listEditing.afterDelete.text === '' && listEditing.afterDelete.source === '',
      JSON.stringify(listEditing.afterDelete));

    // ------------------------------------ typing in the Preview-only layout
    // Everything below drives the real key pipeline (not execCommand) with the
    // preview alone on screen, which is how in-preview editing is actually
    // used. Each case ends by reading back the markdown source, because the
    // source is what gets saved: a preview that looks right over a source that
    // has grown a duplicate or a stray marker is still a broken edit.
    const previewCase = async ({ source, select, at = 'end', span, steps }) => {
      grabFocus();
      await js(`(() => {
        window.__jmd.setLayout('preview');
        window.__jmd.loadDocument(null, ${JSON.stringify(source)});
        const root = document.getElementById('preview');
        root.focus();
        const range = document.createRange();
        ${span ? `
        range.setStart(root.children[${span[0]}].firstChild, ${span[1]});
        range.setEnd(root.children[${span[2]}].firstChild, ${span[3]});` : `
        range.selectNodeContents(${select ? `root.querySelector(${JSON.stringify(select)})` : 'root.firstElementChild'});
        range.collapse(${at === 'start'});`}
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      })()`);
      await wait(150);
      for (const step of steps) {
        if (step === 'blur') {
          // A real window switch, which blurs the contenteditable underneath.
          win.blur();
          await wait(300);
          grabFocus();
          await wait(300);
          continue;
        }
        if (step === 'Enter' || step === 'Tab' || step === 'Backspace') await nativeKey(step);
        else if (step === 'Undo') await nativeKey('Z', ['cmd']);
        else if (step === 'pause') await wait(600);
        else if (step.startsWith('insert:')) {
          await js(`document.execCommand('insertText', false, ${JSON.stringify(step.slice(7))})`);
          await wait(60);
        } else if (step.startsWith('slow:')) {
          for (const char of step.slice(5)) {
            grabFocus();
            await nativeText(char);
            await wait(420);
          }
        } else await nativeText(step);
      }
      await wait(700);
      return js(`(() => {
        const root = document.getElementById('preview');
        const anchor = getSelection().anchorNode;
        const el = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
        let block = el;
        while (block && block.parentElement !== root) block = block.parentElement;
        return {
          source: window.__jmd.editor.getValue(),
          html: root.innerHTML,
          strong: !!root.querySelector('strong'),
          quote: !!root.querySelector('blockquote'),
          caretBlock: block ? [...root.children].indexOf(block) : -1,
          caretText: el?.textContent ?? null,
          focused: document.activeElement === root,
        };
      })()`);
    };

    // Pressing Enter creates a block Markdown cannot spell. Committing used to
    // re-render it away and drop the caret at the end of the previous line, so
    // the next thing typed landed back on the line the user had just left.
    let pc = await previewCase({ source: '', steps: ['aaa', 'Enter', 'bbb'] });
    check('Enter keeps the caret in the new paragraph',
      pc.source === 'aaa\n\nbbb' && pc.caretBlock === 1 && pc.caretText === 'bbb', JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['aaa', 'pause', 'Enter', 'pause', 'bbb'] });
    check('Enter keeps the caret after the edit has already been committed',
      pc.source === 'aaa\n\nbbb' && pc.caretBlock === 1 && pc.caretText === 'bbb', JSON.stringify(pc));

    pc = await previewCase({
      source: '# Doc\n\nfirst\n\n- one\n- two\n', select: 'p', steps: [' xyz', 'Enter', 'second'],
    });
    check('Enter mid-document starts a paragraph instead of typing into the next block',
      pc.source === '# Doc\n\nfirst xyz\n\nsecond\n\n- one\n- two\n' && pc.caretText === 'second',
      JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['x', 'Enter', 'Enter', 'Enter', 'y'] });
    check('repeated Enters do not write blank-looking lines into the source',
      pc.source === 'x\n\ny', JSON.stringify(pc));

    // Leaving a list used to splice the list back in over a range one line
    // short of the one it came from, copying an item on every commit.
    pc = await previewCase({
      source: '', steps: ['- alpha', 'Enter', 'beta', 'Enter', 'Enter', 'tail'],
    });
    check('leaving a list with Enter does not duplicate its items',
      pc.source === '- alpha\n- beta\n\ntail', JSON.stringify(pc));

    // Leaving a list item that ended in inline markup used to hand the new block
    // the browser's own formatting wrappers — <font> after `code`, <i> after
    // emphasis. The first stopped every input rule from firing, so the next
    // `a` stayed literal and reached the source escaped as \`a\`; the second
    // turned plain typing into italics nobody asked for.
    pc = await previewCase({ source: '', steps: ['- `a`', 'Enter', 'Enter', '`a`'] });
    check('inline code still renders after leaving a list',
      pc.source === '- `a`\n\n`a`' && (pc.html.match(/<code>a<\/code>/g) ?? []).length === 2,
      JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['- **b**', 'Enter', 'Enter', 'x'] });
    check('text typed after leaving an emphasised item is not italicised',
      pc.source === '- **b**\n\nx' && !/<em>|<i>/.test(pc.html), JSON.stringify(pc));

    // `**b*` is a complete emphasis on its own inside an item, too.
    pc = await previewCase({ source: '', steps: ['- **b**'] });
    check('bold typed inside a list item survives its last delimiter',
      pc.source === '- **b**' && pc.strong, JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['- alpha', 'Enter', 'pause'] });
    check('an unfinished list item writes no stray marker to the source',
      pc.source === '- alpha', JSON.stringify(pc));

    pc = await previewCase({ source: 'one\n\ntwo\n', select: 'p:nth-of-type(2)', at: 'start', steps: ['Backspace'] });
    check('Backspace merges two paragraphs without duplicating either',
      pc.source === 'onetwo\n', JSON.stringify(pc));

    pc = await previewCase({
      source: 'one\n\ntwo\n\nthree\n', select: 'p:nth-of-type(2)',
      steps: ['Backspace', 'Backspace', 'Backspace', 'Backspace'],
    });
    check('deleting a middle paragraph removes exactly its lines',
      pc.source === 'one\n\nthree\n', JSON.stringify(pc));

    // `**bold**` is typed through `**bold*`, which is a complete emphasis on its
    // own: rendering there stranded the caret inside an <em> mid-word.
    pc = await previewCase({ source: '', steps: ['a **b** c'] });
    check('bold survives being typed one delimiter at a time',
      pc.source === 'a **b** c' && pc.strong, JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['> quoted', 'Enter', 'more'] });
    check('a quote typed with > stays a quote',
      pc.source === '> quoted\n>\n> more' && pc.quote, JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['- one', 'Enter', 'Tab', 'nested'] });
    check('Tab nests a list item instead of moving focus out of the preview',
      pc.source === '- one\n  - nested' && pc.focused, JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['1. one', 'Enter', 'two'] });
    check('an ordered list keeps numbering', pc.source === '1. one\n2. two', JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['- [ ] todo'] });
    check('a task item round-trips with a single space after the box',
      pc.source === '- [ ] todo', JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['insert:こんにちは', 'Enter', 'insert:世界'] });
    check('multi-byte text splits into paragraphs like any other',
      pc.source === 'こんにちは\n\n世界', JSON.stringify(pc));

    // Typing this slowly commits between every keystroke, so each one lands on
    // freshly re-stamped blocks — the state that used to move the caret.
    pc = await previewCase({ source: '# T\n\nalpha\n\n- x\n', select: 'p', steps: ['slow: xy'] });
    check('typing slower than the commit debounce still lands in one place',
      pc.source === '# T\n\nalpha xy\n\n- x\n', JSON.stringify(pc));

    pc = await previewCase({ source: 'one\n\ntwo\n\nthree\n', span: [0, 1, 2, 2], steps: ['X'] });
    check('typing over a selection spanning blocks replaces exactly the selection',
      pc.source === 'oXree\n', JSON.stringify(pc));

    // Read-only blocks cannot hold a caret, so a document ending in one needs a
    // paragraph after it or there is no way to keep writing in the preview.
    pc = await previewCase({
      source: '```js\nlet a;\n```\n', select: ':scope > :last-child', steps: ['below'],
    });
    check('a document ending in a code block can still be written past',
      pc.source === '```js\nlet a;\n```\n\nbelow\n', JSON.stringify(pc));

    pc = await previewCase({ source: '| A | B |\n| - | - |\n| 1 | 2 |\n', select: 'tbody td', steps: ['9'] });
    check('a table cell edit rewrites only that cell',
      pc.source === '| A | B |\n| --- | --- |\n| 19 | 2 |\n', JSON.stringify(pc));

    pc = await previewCase({ source: 'alpha\n', steps: [' beta', 'pause', 'Undo'] });
    check('undo in the preview rolls the source back', pc.source === 'alpha\n', JSON.stringify(pc));

    // Switching away and back must not rebuild the block being written in.
    pc = await previewCase({ source: '', steps: ['aaa', 'Enter', 'blur', 'bbb'] });
    check('leaving the window and coming back keeps the caret where it was',
      pc.source === 'aaa\n\nbbb', JSON.stringify(pc));

    pc = await previewCase({ source: '', steps: ['a **b** and `c` end'] });
    check('a second piece of inline syntax in one paragraph still renders',
      pc.source === 'a **b** and `c` end' && pc.strong && /<code>c<\/code>/.test(pc.html),
      JSON.stringify(pc));

    // markdown-it counts the blank line after a list as part of the list, so
    // editing an item used to swallow it and swallow the next paragraph with it.
    pc = await previewCase({ source: '- one\n- two\n\ntail\n', select: 'li', steps: [' x'] });
    check('editing a list keeps the blank line that ends it',
      pc.source === '- one x\n- two\n\ntail\n', JSON.stringify(pc));

    // One long session: the failures above only showed up in combination.
    pc = await previewCase({
      source: '',
      steps: [
        '# Notes', 'Enter', 'Shipped **today**. See `CHANGELOG`.', 'Enter',
        '## Fixes', 'Enter', '- caret stays', 'Enter', 'items stay unique', 'Enter',
        'Enter', 'Thanks.',
      ],
    });
    check('a whole document typed in the preview matches what was typed',
      pc.source === '# Notes\n\nShipped **today**. See `CHANGELOG`.\n\n## Fixes\n\n' +
        '- caret stays\n- items stay unique\n\nThanks.', JSON.stringify(pc));

    await shot(win, '03-preview-typing');
    await js(`window.__jmd.setLayout('split')`);
    await wait(200);

    /**
     * Type into the source pane, starting at the end of `source` — or at the
     * end of its 1-based line `at`, when the caret belongs mid-document.
     */
    const sourceCase = async (source, steps, at = null) => {
      grabFocus();
      await js(`(() => {
        window.__jmd.setLayout('split');
        window.__jmd.loadDocument(null, ${JSON.stringify(source)});
        const view = window.__jmd.editor.view;
        const doc = view.state.doc;
        view.dispatch({ selection: { anchor: ${at === null ? 'doc.length' : `doc.line(${at}).to`} } });
        window.__jmd.editor.focus();
      })()`);
      await wait(250);
      for (const step of steps) {
        if (['Enter', 'Backspace', 'Tab'].includes(step)) await nativeKey(step);
        else await nativeText(step);
        await wait(120);
      }
      await wait(300);
      return js(`window.__jmd.editor.getValue()`);
    };

    // Enter on an empty item has to leave the list *and* leave a blank line
    // behind it. Without one the next thing typed is a lazy continuation, which
    // Markdown folds straight back into the item above — the list looked
    // finished in the source and was still a bullet in the preview.
    let src = await sourceCase('', ['- a', 'Enter', 'Enter', 'a']);
    check('Enter on an empty list item leaves a one-item list', src === '- a\n\na', JSON.stringify(src));

    src = await sourceCase('', ['- a', 'Enter', 'b', 'Enter', 'Enter', 'c']);
    check('text typed after leaving a list is a paragraph, not the last item',
      src === '- a\n- b\n\nc', JSON.stringify(src));

    src = await sourceCase('', ['1. a', 'Enter', 'b', 'Enter', 'Enter', 'c']);
    check('leaving an ordered list works the same way', src === '1. a\n2. b\n\nc', JSON.stringify(src));

    src = await sourceCase('', ['- a', 'Enter', 'Tab', 'b', 'Enter', 'Enter', 'c']);
    check('Enter on an empty nested item outdents one level instead',
      src === '- a\n  - b\n- c', JSON.stringify(src));

    src = await sourceCase('', ['- a', 'Enter', 'b']);
    check('Enter on an item with text still continues the list',
      src === '- a\n- b', JSON.stringify(src));

    // Inside a fence a marker is code, so Enter must not eat the line it is on.
    src = await sourceCase('```js\n\n```\n', ['- ', 'Enter', 'x'], 2);
    check('a list marker inside a code fence is left alone',
      /^```js\n- \n\s*x\n```\n$/.test(src), JSON.stringify(src));

    const syntaxRules = await js(`(async () => {
      const cases = [
        ['inline code', '\`code\`', 'code'],
        ['bold', '**bold**', 'strong'],
        ['italic', '*italic*', 'em'],
        ['strike', '~~strike~~', 's'],
        ['mark', '==mark==', 'mark'],
        ['subscript', 'H~2~O', 'sub'],
        ['superscript', 'x^2^', 'sup'],
        ['link', '[OpenAI](https://openai.com)', 'a[href]'],
        ['image', '![dot](data:image/png;base64,iVBORw0KGgo=)', 'img'],
        ['math', '$x^2$', '.math-inline'],
        ['quote', '> quoted', 'blockquote'],
        ['rule', '---', 'hr'],
        ['task', '- [ ] task', '.task-checkbox'],
        ['definition', 'Term\\n: meaning', 'dl'],
        ['table', '| A | B |\\n| - | - |\\n| 1 | 2 |', 'table'],
        ['fence', '\`\`\`js\\nconst x = 1;\\n\`\`\`', 'pre code'],
        ['footnote', 'note[^a]\\n\\n[^a]: text', '.footnotes'],
        ['raw html', '<aside>hello</aside>', '.raw-html'],
      ];
      const results = {};
      for (const [name, markdown, selector] of cases) {
        window.__jmd.loadDocument(null, '');
        const root = document.getElementById('preview');
        const p = document.createElement('p');
        p.textContent = markdown;
        root.appendChild(p);
        const range = document.createRange();
        range.selectNodeContents(p);
        range.collapse(false);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        p.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        results[name] = !!root.querySelector(selector);
      }
      return results;
    })()`);
    check('Preview applies every supported Markdown notation while typing',
      Object.values(syntaxRules).every(Boolean), JSON.stringify(syntaxRules));

    // Load a rich fixture for the renderer/editor regression checks below.
    await js(`(() => { window.__jmd.loadDocument(null, [
      '# jmd', '', '**Bold**, *italic*, ==highlighted==, H~2~O and [link](https://example.com).', '',
      '- [x] done', '- [ ] todo', '', '| A | B |', '| - | - |', '| x | y |', '',
      'Footnote[^1]', '', '[^1]: note', '', 'Inline $e^{i\\\\pi}+1=0$.', '',
      '$$', '\\\\int_0^1 x dx', '$$', '', '~~~python', 'for x in range(2):', '    pass', '~~~'
    ].join('\\n')); })()`);
    await wait(500);

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
      await js(`window.__jmd.setTheme('${theme}')`);
      await wait(250);
      await shot(win, `02-theme-${theme}`);
    }
    const themeApplied = await js(`document.documentElement.dataset.theme`);
    check('theme switching works', themeApplied === 'dracula', themeApplied);

    // Selected text has to stay readable in every skin, which takes a colour
    // for the text as well as for the band behind it.
    const selectionTokens = await js(`(() => {
      const out = {};
      for (const id of ['github', 'paper', 'solarized-light', 'nord', 'dracula', 'gruvbox-dark']) {
        const probe = document.createElement('div');
        probe.dataset.theme = id;
        document.body.appendChild(probe);
        const style = getComputedStyle(probe);
        out[id] = {
          band: style.getPropertyValue('--selection').trim(),
          text: style.getPropertyValue('--selection-fg').trim(),
        };
        probe.remove();
      }
      return out;
    })()`);
    check('every theme names both selection colours',
      Object.values(selectionTokens).every((t) => t.band && t.text),
      JSON.stringify(selectionTokens));

    // CodeMirror's base theme has a more specific rule for the *focused*
    // selection, and it reaches for its light palette; the skin has to win.
    grabFocus();
    const focusedBand = await js(`(async () => {
      window.__jmd.setLayout('editor');
      window.__jmd.editor.focus();
      const view = window.__jmd.editor.view;
      view.dispatch({ selection: { anchor: 0, head: Math.min(6, view.state.doc.length) } });
      await new Promise(r => setTimeout(r, 250));
      const piece = document.querySelector('.cm-selectionBackground');
      return piece ? getComputedStyle(piece).backgroundColor : null;
    })()`);
    check('the focused source selection uses the theme colour',
      focusedBand === 'rgb(68, 71, 90)', String(focusedBand));
    await js(`window.__jmd.setLayout('split')`);
    await js(`window.__jmd.setTheme('github')`);
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

    // ------------------------------------------------------- caret readout
    const caret = await js(`(async () => {
      window.__jmd.setLayout('editor');
      const view = window.__jmd.editor.view;
      const read = () => document.getElementById('status-cursor').textContent;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 6 } });
      await new Promise(r => setTimeout(r, 80));
      const point = read();
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from,
                                   head: view.state.doc.line(3).from + 5 } });
      await new Promise(r => setTimeout(r, 80));
      const range = read();
      return { point, range };
    })()`);
    check('the status bar reports the caret line and column',
      caret.point === 'Ln 3, Col 7', caret.point);
    check('a selection is reported beside the position',
      caret.range === 'Ln 3, Col 6 (5 selected)', caret.range);

    // A tab switch replaces the whole state, which goes around the update
    // listener the readout otherwise rides on.
    const caretAfterSwitch = await js(`(async () => {
      const there = window.__jmd.newTab({ content: 'only line\\n' });
      await new Promise(r => setTimeout(r, 120));
      const fresh = document.getElementById('status-cursor').textContent;
      await window.__jmd.closeTab(there);
      await new Promise(r => setTimeout(r, 120));
      return { fresh, back: document.getElementById('status-cursor').textContent };
    })()`);
    check('a new tab resets the caret readout instead of keeping the last one',
      caretAfterSwitch.fresh === 'Ln 1, Col 1', JSON.stringify(caretAfterSwitch));

    // The source text is aligned to its own line numbers. A wide window used to
    // centre the content box, stranding the text away from the gutter.
    const gutterGap = await js(`(() => {
      const pane = document.getElementById('editor-pane');
      const gutters = pane.querySelector('.cm-gutters').getBoundingClientRect();
      const content = pane.querySelector('.cm-content').getBoundingClientRect();
      return { slack: Math.round(pane.getBoundingClientRect().width - content.width),
               gap: Math.round(content.left - gutters.right) };
    })()`);
    check('the source text sits against the gutter however wide the window is',
      gutterGap.slack > 100 && gutterGap.gap === 0, JSON.stringify(gutterGap));
    await js(`window.__jmd.setLayout('split')`);
    await wait(200);

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

    // Typing in the source re-renders the preview, which replaces blocks. That
    // must not read back as an edit made *in* the preview: committing one would
    // convert untouched paragraphs from HTML and flatten their own line breaks.
    const sourceEditEcho = await js(`(async () => {
      window.__jmd.loadDocument(null, '# first\\n\\nwrapped line\\n');
      await new Promise(r => setTimeout(r, 300));
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'second line\\n' } });
      await new Promise(r => setTimeout(r, 400));
      const before = window.__jmd.editor.getValue();
      const dirty = window.__jmd.previewEditor.dirty;
      window.__jmd.previewEditor.commit({ rerender: true });
      await new Promise(r => setTimeout(r, 300));
      return { before, after: window.__jmd.editor.getValue(), dirty };
    })()`);
    check('an edit made in the source is not committed back as a preview edit',
      !sourceEditEcho.dirty && sourceEditEcho.after === sourceEditEcho.before &&
      sourceEditEcho.after === '# first\n\nwrapped line\nsecond line\n',
      JSON.stringify(sourceEditEcho));

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
      window.__jmd.setLayout('split');
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
    const clean = await js(`(() => {
      const tab = document.querySelector('#tabs .tab.is-active');
      return {
        dirtyHidden: !tab.classList.contains('is-dirty'),
        name: tab.querySelector('.tab-name').textContent,
        path: document.getElementById('doc-path-text').textContent,
        pathShown: !document.getElementById('doc-path').hidden,
        pathInHeader: document.getElementById('doc-path').parentElement.id === 'titlebar',
      };
    })()`);
    check('saving clears the dirty marker', clean.dirtyHidden === true && clean.name === 'saved.md',
      JSON.stringify(clean));
    check('the absolute path is shown in the header',
      clean.pathShown && clean.pathInHeader && path.isAbsolute(clean.path) && clean.path === savePath,
      JSON.stringify(clean));

    const droppedPath = path.join(OUT, 'imgtest', 'dropped.md');
    fs.writeFileSync(droppedPath, '# Opened by drop\n', 'utf8');
    const dropped = await js(`(async () => {
      const before = window.__jmd.tabs.length;
      const opened = await window.__jmd.openDroppedPaths([${JSON.stringify(droppedPath)}]);
      const result = {
        opened,
        added: window.__jmd.tabs.length === before + 1,
        path: window.__jmd.activeTab.path,
        text: window.__jmd.editor.getValue(),
      };
      await window.__jmd.closeTab(window.__jmd.activeTab);
      return result;
    })()`);
    check('a dropped Markdown file opens in a tab',
      dropped.opened === 1 && dropped.added && dropped.path === droppedPath && dropped.text === '# Opened by drop\n',
      JSON.stringify(dropped));

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

    // ---------------------------------------------------- following the disk
    const watchPath = path.join(OUT, 'imgtest', 'watched.md');
    fs.writeFileSync(watchPath, '# watched\n', 'utf8');
    await js(`(async () => {
      const file = await window.jmd.readFile(${JSON.stringify(watchPath)});
      window.__jmd.newTab({ path: file.path, content: file.content });
    })()`);
    await wait(500);
    fs.writeFileSync(watchPath, '# watched\n\nchanged outside\n', 'utf8');
    await wait(1000);
    const followed = await js(`(() => ({
      text: window.__jmd.editor.getValue(),
      dirty: document.querySelector('#tabs .tab.is-active').classList.contains('is-dirty'),
      preview: document.getElementById('preview').textContent.includes('changed outside'),
    }))()`);
    check('a tab with no unsaved work follows the file on disk',
      followed.text === '# watched\n\nchanged outside\n' && !followed.dirty && followed.preview,
      JSON.stringify(followed));

    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: '\\nmine\\n' } });
      document.getElementById('status-msg').textContent = '';
    })()`);
    await wait(300);
    fs.writeFileSync(watchPath, '# clobbered\n', 'utf8');
    await wait(1000);
    const keptUnsaved = await js(`(async () => {
      const result = {
        text: window.__jmd.editor.getValue(),
        message: document.getElementById('status-msg').textContent,
      };
      const tab = window.__jmd.activeTab;
      tab.saved = window.__jmd.editor.getValue();
      await window.__jmd.closeTab(tab);
      return result;
    })()`);
    check('a tab with unsaved work keeps it, and says the file moved under it',
      keptUnsaved.text.includes('mine') && !keptUnsaved.text.includes('clobbered') &&
      /changed on disk/.test(keptUnsaved.message), JSON.stringify(keptUnsaved));

    // ------------------------------------------------------- find in preview
    await js(`(() => {
      window.__jmd.setLayout('preview');
      window.__jmd.loadDocument(null, [
        '# Alpha heading', '', 'The quick brown fox jumps over the lazy dog.', '',
        '- alpha one', '- alpha two', '', 'Tail paragraph mentioning alpha again.', '',
      ].join('\\n'));
    })()`);
    await wait(400);
    const found = await js(`(() => {
      window.__jmd.openFind();
      const input = document.getElementById('find-input');
      input.value = 'alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.__jmd.previewFind.step(1);
      return {
        visible: !document.getElementById('find').hidden,
        matches: window.__jmd.previewFind.ranges.length,
        count: document.getElementById('find-count').textContent,
        painted: !!CSS.highlights.get('jmd-find-current'),
      };
    })()`);
    check('the preview can be searched', found.visible && found.matches === 4 &&
      found.count === '2/4' && found.painted, JSON.stringify(found));
    await shot(win, '09-find-preview');

    const findLive = await js(`(async () => {
      // A block boundary is not a place a match may straddle.
      window.__jmd.loadDocument(null, 'one\\n\\ntwo\\n');
      const input = document.getElementById('find-input');
      input.value = 'onetwo';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const across = window.__jmd.previewFind.ranges.length;
      input.value = 'two';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'two two two\\n' } });
      await new Promise(r => setTimeout(r, 400));
      const live = window.__jmd.previewFind.ranges.length;
      document.getElementById('find-close').click();
      return { across, live, cleared: !CSS.highlights.get('jmd-find-current') };
    })()`);
    check('preview matches never cross a block and follow every re-render',
      findLive.across === 0 && findLive.live === 3 && findLive.cleared, JSON.stringify(findLive));
    await js(`window.__jmd.setLayout('split')`);
    await wait(200);

    // ---------------------------------------------------------------- tabs
    const press = (accel) => {
      const parts = accel.split('+');
      const key = parts.pop();
      const code = /^\d$/.test(key) ? `Digit${key}` : /^[A-Z]$/.test(key) ? `Key${key}` : key;
      const init = {
        key, code, bubbles: true, cancelable: true,
        metaKey: parts.includes('Cmd'), ctrlKey: parts.includes('Ctrl'),
        altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'),
      };
      return js(`document.body.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(init)}))`);
    };
    const tabState = () => js(`(() => {
      const j = window.__jmd;
      return {
        count: j.tabs.length,
        dom: document.querySelectorAll('#tabs .tab').length,
        active: j.activeTab && (j.activeTab.path ? j.activeTab.path.split('/').pop() : 'Untitled'),
        text: j.editor.getValue().split('\\n')[0],
        layout: document.getElementById('panes').className,
      };
    })()`);

    await js(`(() => {
      window.__jmd.newTab({ path: '/tmp/jmd-alpha.md', content: '# Alpha\\n' });
      window.__jmd.newTab({ path: '/tmp/jmd-beta.md', content: '# Beta\\n' });
    })()`);
    await wait(300);
    let state = await tabState();
    check('tabs open alongside each other', state.count === 3 && state.dom === 3, JSON.stringify(state));
    check('the newest tab becomes active', state.active === 'jmd-beta.md', JSON.stringify(state));

    await press('Cmd+2');
    await wait(250);
    state = await tabState();
    check('⌘2 switches to the second tab',
      state.active === 'jmd-alpha.md' && state.text === '# Alpha', JSON.stringify(state));

    await press('Cmd+Tab');
    await wait(250);
    state = await tabState();
    check('⌘⇥ moves to the next tab', state.active === 'jmd-beta.md', JSON.stringify(state));

    await press('Cmd+Shift+Tab');
    await wait(250);
    state = await tabState();
    check('⌘⇧⇥ moves back', state.active === 'jmd-alpha.md', JSON.stringify(state));

    // macOS normally reserves ⌘⇥ before an app can see it, so ⌃⇥ is also a
    // practical default when using a physical keyboard.
    await press('Ctrl+Tab');
    await wait(250);
    state = await tabState();
    check('⌃⇥ is also available for next tab', state.active === 'jmd-beta.md', JSON.stringify(state));
    await press('Cmd+Shift+Tab');
    await wait(250);

    // Each tab keeps its own text and undo history.
    await js(`(() => {
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'edited in alpha\\n' } });
    })()`);
    await wait(300);
    await press('Cmd+3');
    await wait(250);
    await press('Cmd+2');
    await wait(250);
    const kept = await js(`window.__jmd.editor.getValue()`);
    check('a tab keeps its own document across switches', kept.includes('edited in alpha'),
      JSON.stringify(kept));

    await shot(win, '06-tabs');

    // Layout moved to ⌘⌃1/2/3 to free the digits for tabs.
    await press('Cmd+Ctrl+1');
    await wait(250);
    state = await tabState();
    check('⌘⌃1 shows the editor only', state.layout === 'layout-editor', state.layout);
    check('the status bar reports the current layout',
      await js(`document.getElementById('status-layout').textContent`) === 'Editor');
    await press('Cmd+Ctrl+3');
    await wait(250);
    state = await tabState();
    check('⌘⌃3 shows the preview only', state.layout === 'layout-preview', state.layout);
    await press('Cmd+Ctrl+2');
    await wait(250);
    state = await tabState();
    check('⌘⌃2 restores the split', state.layout === 'layout-split', state.layout);

    // Rebinding is what the shortcut settings do under the hood.
    await js(`(() => {
      window.__jmd.shortcuts.assign('tab.next', 'Cmd+Alt+K');
      window.__jmd.activateTab(window.__jmd.tabs[0]);
    })()`);
    await wait(200);
    await press('Cmd+Alt+K');
    await wait(250);
    state = await tabState();
    check('a rebound shortcut takes effect immediately',
      state.active === 'jmd-alpha.md', JSON.stringify(state));

    const closed = await js(`(async () => {
      // Beta is untouched, so closing it must not raise a save prompt.
      await window.__jmd.closeTab(window.__jmd.tabs[2]);
      return { count: window.__jmd.tabs.length, dom: document.querySelectorAll('#tabs .tab').length };
    })()`);
    check('closing a clean tab removes it', closed.count === 2 && closed.dom === 2,
      JSON.stringify(closed));

    // -------------------------------------------------------- dragging tabs
    const names = `[...document.querySelectorAll('#tabs .tab .tab-name')].map(n => n.textContent)`;
    const reordered = await js(`(() => {
      const strip = document.getElementById('tabs');
      const before = ${names};
      const drag = (source, target, clientX) => {
        const dataTransfer = new DataTransfer();
        const at = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY: 8 };
        source.dispatchEvent(new DragEvent('dragstart', at));
        target.dispatchEvent(new DragEvent('dragover', at));
        target.dispatchEvent(new DragEvent('drop', at));
        source.dispatchEvent(new DragEvent('dragend', at));
      };
      // Last tab onto the left half of the first one, then back past the end.
      const first = strip.firstElementChild;
      drag(strip.lastElementChild, first, first.getBoundingClientRect().left + 4);
      const swapped = ${names};
      drag(strip.firstElementChild, strip, strip.getBoundingClientRect().right - 2);
      return { before, swapped, toEnd: ${names},
               model: window.__jmd.tabs.map(t => t.path ? t.path.split('/').pop() : 'Untitled') };
    })()`);
    check('a tab can be dragged into a new position',
      JSON.stringify(reordered.swapped) === JSON.stringify([...reordered.before].reverse()) &&
      JSON.stringify(reordered.toEnd) === JSON.stringify(reordered.before) &&
      JSON.stringify(reordered.model) === JSON.stringify(reordered.toEnd),
      JSON.stringify(reordered));

    // Released outside the window, a tab takes its document into one of its own.
    await js(`(() => {
      window.__jmd.newTab({ path: null, content: '# moved\\n' });
      const view = window.__jmd.editor.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'unsaved line\\n' } });
    })()`);
    await wait(300);
    const tabsBeforeDetach = await js(`window.__jmd.tabs.length`);
    await js(`(() => {
      const source = document.getElementById('tabs').lastElementChild;
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent('dragend', {
        bubbles: true, cancelable: true, dataTransfer,
        screenX: window.screenX + window.outerWidth + 220,
        screenY: window.screenY + 140,
      }));
    })()`);
    await wait(1500);
    const { BrowserWindow } = require('electron');
    const spawned = BrowserWindow.getAllWindows().filter((w) => w !== win);
    const detached = await js(`window.__jmd.tabs.length`);
    let adopted = null;
    if (spawned.length === 1) {
      adopted = await spawned[0].webContents.executeJavaScript(`(() => ({
        tabs: window.__jmd.tabs.length,
        text: window.__jmd.editor.getValue(),
        dirty: window.__jmd.tabs[0].saved !== window.__jmd.editor.getValue(),
      }))()`, true);
    }
    check('a tab dropped outside the window moves into a new one, unsaved text included',
      spawned.length === 1 && detached === tabsBeforeDetach - 1 && adopted?.tabs === 1 &&
      adopted.text === '# moved\nunsaved line\n' && adopted.dirty,
      JSON.stringify({ tabsBeforeDetach, detached, windows: spawned.length, adopted }));

    // …and dragging it back onto the first window puts it there, which leaves
    // the window it came from with nothing to show and so closes it.
    let merged = null;
    if (spawned.length === 1) {
      const target = win.getBounds();
      const from = spawned[0].getBounds();
      // Somewhere inside the first window but outside the one being dragged
      // from, or the release never counts as leaving that window at all.
      const dropX = from.x > target.x + 80 ? target.x + 40 : target.x + target.width - 40;
      const dropY = target.y + 60;
      await spawned[0].webContents.executeJavaScript(`(() => {
        const source = document.getElementById('tabs').firstElementChild;
        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        source.dispatchEvent(new DragEvent('dragend', {
          bubbles: true, cancelable: true, dataTransfer,
          screenX: ${Math.round(dropX)},
          screenY: ${Math.round(dropY)},
        }));
      })()`, true);
      await wait(1200);
      merged = await js(`(() => ({
        tabs: window.__jmd.tabs.length,
        text: window.__jmd.editor.getValue(),
        dirty: document.querySelector('#tabs .tab.is-active').classList.contains('is-dirty'),
        windows: 0,
      }))()`);
      merged.windows = BrowserWindow.getAllWindows().filter((w) => w !== win).length;
    }
    check('dragging a tab back onto another window merges it there',
      merged?.tabs === tabsBeforeDetach && merged.text === '# moved\nunsaved line\n' &&
      merged.dirty && merged.windows === 0, JSON.stringify(merged));
    // The move goes through the main process, so the drop itself must be inert:
    // otherwise the editable preview writes the drag's payload into the text.
    const dropGuard = await js(`(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', '7');
      dataTransfer.setData('application/x-jmd-tab', '7');
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });
      document.getElementById('preview').dispatchEvent(event);
      return event.defaultPrevented;
    })()`);
    check('a tab from another window is never dropped into the document as text',
      dropGuard === true, String(dropGuard));

    await js(`(async () => {
      const tab = window.__jmd.activeTab;
      tab.saved = window.__jmd.editor.getValue();
      await window.__jmd.closeTab(tab);
    })()`);
    await wait(300);

    // --------------------------------------------------------- wide width
    const measure = () => js(`(() => ({
      wide: window.__jmd.settings.wide,
      widths: window.__jmd.settings.widths,
      attr: document.documentElement.dataset.width,
      preview: getComputedStyle(document.getElementById('preview')).maxWidth,
      source: getComputedStyle(document.querySelector('.cm-content')).maxWidth,
      status: document.getElementById('status-width').textContent,
    }))()`);

    await js(`window.__jmd.setWide(false)`);
    await wait(200);
    const normalWidth = await measure();
    check('the normal column is the narrower of the two widths',
      normalWidth.attr === 'normal' && normalWidth.preview === normalWidth.source &&
      parseFloat(normalWidth.preview) > 0 && normalWidth.status === 'Normal',
      JSON.stringify(normalWidth));

    await press('Cmd+Ctrl+W');
    await wait(250);
    const wideWidth = await measure();
    check('the wide shortcut widens both panes together',
      wideWidth.wide === true && wideWidth.attr === 'wide' &&
      wideWidth.preview === wideWidth.source &&
      parseFloat(wideWidth.preview) > parseFloat(normalWidth.preview),
      JSON.stringify(wideWidth));

    // Each width is a stored parameter, and changing the one in force is live.
    await js(`window.__jmd.setWidths({ wide: 90 })`);
    await wait(200);
    const custom = await measure();
    check('the wide width is configurable and applies at once',
      custom.widths.wide === 90 && Math.round(parseFloat(custom.preview)) === 90 * 16,
      JSON.stringify(custom));

    // Out-of-range values are clamped rather than taken literally.
    await js(`window.__jmd.setWidths({ normal: 5, wide: 999 })`);
    await wait(150);
    const clamped = await js(`window.__jmd.settings.widths`);
    check('stored widths are clamped to a usable range',
      clamped.normal === 30 && clamped.wide === 120, JSON.stringify(clamped));

    const exportedWidth = await js(`(() => {
      window.__jmd.setWidths({ normal: 46, wide: 72 });
      const html = window.__jmd.buildExportHtml();
      return /max-width: 72rem/.test(html);
    })()`);
    check('an export carries the width the document is read at', exportedWidth === true,
      String(exportedWidth));

    await js(`document.getElementById('status-width').click()`);
    await wait(200);
    const toggledBack = await measure();
    check('the status bar reading toggles wide mode back off',
      toggledBack.wide === false && toggledBack.status === 'Normal' &&
      toggledBack.preview === normalWidth.preview, JSON.stringify(toggledBack));

    // ---------------------------------------------------------------- vim
    /** Real keydowns on the editor content, which is where vim reads them. */
    const vimKeys = (...keys) => js(`(() => {
      const content = document.querySelector('.cm-content');
      for (const key of ${JSON.stringify(keys)}) {
        content.dispatchEvent(new KeyboardEvent('keydown',
          { key, bubbles: true, cancelable: true }));
      }
    })()`);
    const vimState = () => js(`(() => {
      const badge = document.getElementById('status-vim');
      return {
        on: window.__jmd.settings.vim,
        editorVim: window.__jmd.editor.vim,
        hidden: badge.hidden,
        badge: badge.textContent,
        mode: badge.dataset.mode,
        wysiwyg: window.__jmd.previewEditor.enabled,
        doc: window.__jmd.editor.getValue(),
        panel: !!document.querySelector('.cm-vim-panel'),
        // The vim engine hangs off the view while the extension is loaded.
        live: !!window.__jmd.editor.view.cm,
      };
    })()`);

    check('vim mode is off until it is asked for', (await vimState()).on === false);

    await press('Cmd+Ctrl+V');
    await wait(250);
    const vimOn = await vimState();
    check('the vim shortcut turns modal editing on and says which mode it is in',
      vimOn.on === true && vimOn.editorVim === true && vimOn.hidden === false &&
      vimOn.badge === 'NORMAL' && vimOn.mode === 'normal' && vimOn.wysiwyg === false,
      JSON.stringify(vimOn));

    // Every other tab holds a document configured before the setting changed;
    // each one is reconciled on its way back into the view.
    const switched = await js(`(() => {
      const j = window.__jmd;
      const from = j.activeTab.id;
      j.activateTab(j.tabs.find((tab) => tab.id !== from));
      return j.activeTab.id !== from;
    })()`);
    await wait(200);
    const parked = await vimState();
    check('a tab parked before vim was on comes back with it',
      switched === true && parked.live === true && parked.badge === 'NORMAL',
      JSON.stringify(parked));

    await js(`window.__jmd.loadDocument(null, 'alpha\\nbravo\\ncharlie\\n');
              window.__jmd.editor.goToLine(0);
              window.__jmd.editor.focus();`);
    await wait(200);
    await vimKeys('d', 'd');
    await wait(150);
    const deleted = await vimState();
    check('an operator and a motion compose into a command',
      deleted.doc === 'bravo\ncharlie\n', JSON.stringify(deleted.doc));

    await vimKeys('u');
    await wait(150);
    check('vim undo goes through the document history',
      (await vimState()).doc === 'alpha\nbravo\ncharlie\n');

    // A half-typed command is shown the way vim's own `showcmd` does.
    await vimKeys('2');
    await wait(120);
    const pending = await vimState();
    check('a command in progress is reported beside the mode',
      pending.badge === 'NORMAL 2', JSON.stringify(pending));

    await vimKeys('Escape', 'v');
    await wait(150);
    const visual = await vimState();
    check('visual mode is entered and shown',
      visual.mode === 'visual' && visual.badge === 'VISUAL', JSON.stringify(visual));

    await vimKeys('Escape', ':');
    await wait(200);
    const exLine = await vimState();
    check('the ex line opens on `:`', exLine.panel === true, JSON.stringify(exLine));
    await shot(win, '11-vim-normal');
    await vimKeys('Escape');
    await wait(150);

    // `:w` has to reach the app's own save, not vim's idea of a file.
    const exPath = path.join(OUT, 'imgtest', 'ex-written.md');
    if (fs.existsSync(exPath)) fs.unlinkSync(exPath);
    await js(`(() => {
      window.__jmd.loadDocument(${JSON.stringify(exPath)}, 'written by ex\\n');
      window.__jmd.editor.focus();
    })()`);
    await wait(200);
    await vimKeys(':');
    await wait(200);
    await js(`(() => {
      const input = document.querySelector('.cm-vim-panel input');
      input.value = 'w';
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { get: () => 13 });
      input.dispatchEvent(event);
    })()`);
    await wait(600);
    const exWritten = fs.existsSync(exPath) ? fs.readFileSync(exPath, 'utf8') : '';
    check('`:w` saves the document the tab is holding',
      exWritten === 'written by ex\n', JSON.stringify(exWritten));

    // Real keys this time: insert mode is the half of vim that has to *stop*
    // handling keys, and the markdown Enter has to survive underneath it.
    grabFocus();
    await js(`window.__jmd.loadDocument(null, '- one\\n');
              window.__jmd.editor.goToLine(0);
              window.__jmd.editor.focus();`);
    await wait(250);
    await nativeKey('A', ['shift']);
    await wait(150);
    const insert = await vimState();
    check('an insert command hands typing back to the editor',
      insert.mode === 'insert' && insert.badge === 'INSERT', JSON.stringify(insert));

    await nativeKey('Enter');
    await nativeText('two');
    await wait(200);
    const continued = await vimState();
    check('the markdown list continuation still runs in insert mode',
      continued.doc === '- one\n- two\n', JSON.stringify(continued.doc));

    await nativeKey('Escape');
    await wait(150);
    check('Esc returns to normal mode', (await vimState()).mode === 'normal');

    // Preview-only has no source pane at all, so the reading goes with it.
    await js(`window.__jmd.setLayout('preview')`);
    await wait(250);
    const inPreview = await vimState();
    check('the vim reading goes away with the source pane',
      inPreview.on === true && inPreview.hidden === true, JSON.stringify(inPreview));

    await js(`window.__jmd.setVim(false); window.__jmd.setVim(true);`);
    await wait(350);
    const reclaimed = await js(`(() => ({
      layout: window.__jmd.settings.layout,
      wysiwyg: window.__jmd.previewEditor.enabled,
      hidden: document.getElementById('status-vim').hidden,
      inEditor: !!document.activeElement.closest('#editor-pane'),
    }))()`);
    check('turning vim on from preview-only puts the source pane back in charge',
      reclaimed.layout === 'split' && reclaimed.wysiwyg === false &&
      reclaimed.hidden === false && reclaimed.inEditor === true,
      JSON.stringify(reclaimed));

    await js(`window.__jmd.setVim(false)`);
    await wait(200);
    await vimKeys('d', 'd');
    await wait(150);
    const vimOff = await vimState();
    check('turning vim off puts the keys and the status bar back',
      vimOff.on === false && vimOff.editorVim === false && vimOff.hidden === true &&
      vimOff.doc === '- one\n- two\n', JSON.stringify(vimOff));

    // ------------------------------------------------------ settings panel
    await press('Cmd+,');
    await wait(300);
    const settingsOpen = await js(`(() => ({
      open: !document.getElementById('settings').hidden,
      skins: document.querySelectorAll('#skin-grid .skin').length,
      layouts: document.querySelectorAll('#layout-setting [data-layout]').length,
      widths: document.querySelectorAll('#width-setting [data-wide]').length,
      sliders: document.querySelectorAll('.width-row .width-range').length,
      rows: document.querySelectorAll('.shortcut-row').length,
    }))()`);
    check('the settings dialog opens',
      settingsOpen.open && settingsOpen.skins >= 6 && settingsOpen.layouts === 3 &&
      settingsOpen.widths === 2 && settingsOpen.sliders === 2,
      JSON.stringify(settingsOpen));

    await js(`document.querySelector('.nav-btn[data-section="shortcuts"]').click()`);
    await wait(200);
    const shortcutRows = await js(`(() => ({
      rows: document.querySelectorAll('.shortcut-row').length,
      chips: [...document.querySelectorAll('.shortcut-row')][0].querySelectorAll('.chip').length,
      first: document.querySelector('.shortcut-row .chip')?.textContent ?? '',
    }))()`);
    check('every action is listed with its keys', shortcutRows.rows >= 15 && shortcutRows.chips >= 2,
      JSON.stringify(shortcutRows));
    await shot(win, '07-settings-shortcuts');

    await js(`document.querySelector('.nav-btn[data-section="editor"]').click()`);
    await wait(200);
    const editorPane = await js(`(() => ({
      visible: !document.getElementById('pane-editor').hidden,
      options: document.querySelectorAll('#vim-setting [data-vim]').length,
      active: document.querySelector('#vim-setting .btn.is-active')?.dataset.vim,
      keys: document.querySelectorAll('.vim-help kbd').length,
    }))()`);
    check('the editor pane carries the vim toggle and its key reference',
      editorPane.visible && editorPane.options === 2 && editorPane.active === 'off' &&
      editorPane.keys > 30, JSON.stringify(editorPane));
    await shot(win, '12-settings-editor');

    await js(`window.__jmd.settingsPanel.close(); window.__jmd.settingsPanel.open();`);
    await wait(200);
    const reopened = await js(`(() => ({
      section: window.__jmd.settings.settingsSection,
      visible: !document.getElementById('pane-editor').hidden,
      stored: JSON.parse(localStorage.getItem('jmd.settings') ?? '{}').settingsSection,
    }))()`);
    check('the settings panel reopens on the section last used',
      reopened.section === 'editor' && reopened.visible && reopened.stored === 'editor',
      JSON.stringify(reopened));

    await js(`document.querySelector('.nav-btn[data-section="appearance"]').click();
              window.__jmd.setAccent('#bf3989');`);
    await wait(250);
    const accent = await js(`(() => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      stored: window.__jmd.settings.accent,
    }))()`);
    check('a custom accent colour tints the skin',
      accent.accent === '#bf3989' && accent.stored === '#bf3989', JSON.stringify(accent));
    await shot(win, '08-settings-appearance');

    await js(`window.__jmd.setAccent(null); window.__jmd.settingsPanel.close();`);
    await wait(200);
    const reset = await js(`document.documentElement.style.getPropertyValue('--accent')`);
    check('the accent can be handed back to the skin', reset === '', JSON.stringify(reset));

    // -------------------------------------------------------- about dialog
    await js(`window.__jmd.runAction('app.about')`);
    await wait(300);
    const about = await js(`(() => ({
      open: !document.getElementById('about').hidden,
      version: document.querySelector('.about-version')?.textContent ?? '',
      icon: !!document.querySelector('.about-icon')?.naturalWidth,
      links: [...document.querySelectorAll('#about-body [data-url]')].map(el => el.dataset.url),
    }))()`);
    check('the about dialog shows the version, the icon and the project links',
      about.open && /Version \d+\.\d+\.\d+/.test(about.version) && about.icon &&
        about.links.includes('https://github.com/jojonki/jmd') &&
        about.links.includes('https://github.com/sponsors/jojonki'),
      JSON.stringify(about));
    await shot(win, '10-about');

    await js(`window.__jmd.aboutPanel.close()`);
    await wait(150);
    check('the about dialog closes', await js(`document.getElementById('about').hidden`));
  } catch (error) {
    check('smoke run completed without exception', false, String(error && error.stack ? error.stack : error));
  }

  const consoleErrors = await js(`window.__jmdErrors ?? []`).catch(() => []);
  check('no uncaught renderer errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length ? 1 : 0);
};

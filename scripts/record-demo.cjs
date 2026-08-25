/**
 * Records docs/jmd-demo.gif — the loop at the top of the README — by driving
 * the real app and capturing its window frame by frame.
 *
 *   npm run demo
 *
 * What is shown, in which order and for how long is docs/demo-scenario.md;
 * this file is only the hands. Everything the viewer sees happens the way a
 * person would do it: text arrives as key events, themes change by clicking
 * the swatches in Settings. The app's own functions are used only to put the
 * caret somewhere and to scroll, which a mouse would do less repeatably.
 *
 * Frames are timed on a wall clock rather than assumed to arrive on the beat —
 * `capturePage` takes as long as it takes — so each one is written down with
 * the moment it was taken and ffmpeg resamples that timeline to a steady frame
 * rate. A slow capture then stretches nothing.
 *
 * Needs ffmpeg on PATH.
 */
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DEMO_MD = path.join(ROOT, 'docs', 'demo.md');
const OUT_GIF = path.join(ROOT, 'docs', 'jmd-demo.gif');

/** The GIF's frame rate and width; its height follows the window's aspect. */
const FPS = 10;
const WIDTH = 1000;
const FRAME_MS = Math.round(1000 / FPS);

/** How long a typed character takes: brisk, but readable at ten frames a second. */
const KEY_MS = 45;

/**
 * The path shown in the header. The recording opens a real file out of a
 * temporary directory, which would put a machine-specific path on screen for
 * ten seconds; this is the stand-in the previous demo used in its place.
 */
const SHOWN_PATH = '/Users/demo/jmd/README.md';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------- the frames

/**
 * Captures the window until it is stopped, at roughly `FRAME_MS` apart, and
 * writes each frame to `dir` at the GIF's own size — a full-resolution PNG per
 * frame is several megabytes, and all of it would be thrown away later.
 */
function startCapture(wc, dir) {
  const frames = [];
  let running = true;

  const finished = (async () => {
    let index = 0;
    while (running) {
      const at = Date.now();
      const image = await wc.capturePage();
      const file = path.join(dir, `f${String(index++).padStart(4, '0')}.png`);
      await fsp.writeFile(file, image.resize({ width: WIDTH, quality: 'best' }).toPNG());
      frames.push({ file, at });
      const spent = Date.now() - at;
      if (spent < FRAME_MS) await wait(FRAME_MS - spent);
    }
  })();

  return {
    frames,
    async stop() {
      running = false;
      await finished;
    },
  };
}

/**
 * The concat demuxer's idea of a timeline: every frame with the time until the
 * next one. The last file is repeated because concat gives the final entry no
 * duration of its own otherwise.
 */
async function writeFrameList(frames, dir) {
  const lines = [];
  for (const [index, frame] of frames.entries()) {
    const next = frames[index + 1];
    const seconds = ((next ? next.at - frame.at : FRAME_MS) / 1000).toFixed(3);
    lines.push(`file '${path.basename(frame.file)}'`, `duration ${seconds}`);
  }
  lines.push(`file '${path.basename(frames[frames.length - 1].file)}'`);
  const list = path.join(dir, 'frames.txt');
  await fsp.writeFile(list, `${lines.join('\n')}\n`);
  return list;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

/**
 * One palette for the whole clip rather than one per frame: the theme changes
 * at the end move every colour on screen at once, and a per-frame palette
 * makes that read as a flicker.
 *
 * Undithered, which for a flat interface costs nothing visible — there is no
 * gradient to band — and saves the file a third of its size, since dithering
 * noise is exactly what a GIF cannot compress.
 */
async function encodeGif(list, output) {
  const filters = [
    `fps=${FPS}`,
    `scale=${WIDTH}:-1:flags=lanczos`,
    'split[a][b]',
    '[a]palettegen=max_colors=128:stats_mode=full[p]',
    '[b][p]paletteuse=dither=none',
  ].join(',');
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-filter_complex', filters,
    '-loop', '0',
    output,
  ]);
}

// ------------------------------------------------------------- the recording

module.exports = async function record(win, { app }) {
  const wc = win.webContents;
  await new Promise((resolve) => (wc.isLoading() ? wc.once('did-finish-load', resolve) : resolve()));
  await wait(1200);

  /** Scripts end in `null`: the result crosses a process boundary, and a DOM
   *  node cannot be cloned across it. */
  const js = (code) => wc.executeJavaScript(`(() => {\n${code}\nreturn null;\n})()`, true);
  const read = (expression) => wc.executeJavaScript(expression, true);

  const focus = () => {
    app.focus({ steal: true });
    win.focus();
    wc.focus();
  };

  const type = async (text, perChar = KEY_MS) => {
    for (const char of text) {
      wc.sendInputEvent({ type: 'char', keyCode: char });
      await wait(perChar);
    }
  };

  const clickOn = async (selector) => {
    const at = await read(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    })()`);
    if (!at) throw new Error(`nothing to click: ${selector}`);
    wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    await wait(70);
    wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await wait(40);
    wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await wait(120);
  };

  /** The card in the corner naming the mode on screen; no argument hides it. */
  const caption = (title, detail) => js(`
    let card = document.getElementById('demo-caption');
    if (!card) {
      card = document.createElement('div');
      card.id = 'demo-caption';
      card.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:38px', 'z-index:9999',
        'padding:9px 14px', 'border-radius:8px', 'text-align:left',
        'background:var(--bg-elevated)', 'border:1px solid var(--border)',
        'box-shadow:0 8px 24px rgba(0,0,0,.28)', 'font-family:var(--font-ui)',
        'transition:opacity .2s ease', 'pointer-events:none', 'opacity:0',
      ].join(';');
      document.body.appendChild(card);
    }
    const title = ${JSON.stringify(title ?? '')};
    if (!title) {
      card.style.opacity = '0';
    } else {
      card.innerHTML = '<div style="font-size:12.5px;font-weight:600;color:var(--fg)"></div>'
        + '<div style="font-size:11.5px;margin-top:2px;color:var(--fg-muted)"></div>';
      card.firstChild.textContent = title;
      card.lastChild.textContent = ${JSON.stringify(detail ?? '')};
      card.style.opacity = '1';
    }
  `);

  /** Put the source caret at the end of the first line holding `needle`. */
  const caretAfter = (needle) => js(`
    const view = window.__jmd.editor.view;
    const at = view.state.doc.toString().indexOf(${JSON.stringify(needle)});
    if (at < 0) throw new Error('not in the document: ' + ${JSON.stringify(needle)});
    const head = at + ${JSON.stringify(needle)}.length;
    view.dispatch({ selection: { anchor: head }, scrollIntoView: true });
    view.focus();
  `);

  // ------------------------------------------------------ the starting state

  const complete = await fsp.readFile(DEMO_MD, 'utf8');
  // The recording types its way from here back to the document as committed;
  // taking the three edits out of the finished file keeps the two in step.
  const opening = complete
    .replace(' — fast and focused.', '')
    .replace(' Built for your flow.', '')
    .replace('- [x] Direct rich-text editing\n', '');
  if (opening === complete) throw new Error('docs/demo.md no longer holds the lines the demo types');

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jmd-demo-'));
  const docPath = path.join(workDir, 'README.md');
  await fsp.writeFile(docPath, opening);

  await js(`
    window.__jmd.setTheme('nord');
    window.__jmd.setWysiwyg(false);
    window.__jmd.setLayout('editor');
    window.__jmd.openInTab(${JSON.stringify(docPath)}, ${JSON.stringify(opening)});
  `);
  // The header reports where the file really is; hold the stand-in over it for
  // the length of the recording, including the re-renders a save or an edit
  // would otherwise use to put the true path back.
  await js(`
    const label = document.getElementById('doc-path-text');
    const pin = () => {
      if (label.textContent !== ${JSON.stringify(SHOWN_PATH)}) {
        label.textContent = ${JSON.stringify(SHOWN_PATH)};
      }
    };
    new MutationObserver(pin).observe(label, { childList: true, characterData: true, subtree: true });
    pin();
  `);
  await caretAfter('A simple, lightweight Markdown editor');
  await caption('Text editor', 'Edit Markdown with full focus');
  focus();
  await wait(700);

  // ------------------------------------------------------------------ action

  const frameDir = path.join(workDir, 'frames');
  await fsp.mkdir(frameDir);
  const capture = startCapture(wc, frameDir);
  const started = Date.now();
  /** Wait until `ms` into the recording, so every beat lands where it should. */
  const at = async (ms) => {
    const left = started + ms - Date.now();
    if (left > 0) await wait(left);
  };

  // 1. The source, alone.
  await at(600);
  await type(' — fast and focused.');
  await at(2000);

  // 2. The source and the preview, side by side.
  await js(`window.__jmd.setLayout('split');`);
  await caption('Editor + Preview', 'See every change rendered in real time');
  await caretAfter('- [x] Live preview');
  // The newline goes in directly: pressing Enter here would run the markdown
  // list continuation, and the item would arrive half-written before the
  // typing starts.
  await js(`
    const view = window.__jmd.editor.view;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: '\\n' }, selection: { anchor: head + 1 } });
    view.focus();
  `);
  await at(2350);
  await type('- [x] Direct rich-text editing');
  await at(4200);

  // 3. The rendered document, edited in place.
  await js(`
    window.__jmd.setLayout('preview');
    window.__jmd.setWysiwyg(true);
  `);
  await caption('Rich-text editor', 'Edit the rendered document directly');
  await js(`
    const root = document.getElementById('preview');
    const paragraph = root.querySelector('p');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
  `);
  await at(4500);
  await type(' Built for your flow.');
  // Long enough for the edit to be converted back into the markdown source.
  await at(5900);
  await js(`
    const pane = document.getElementById('preview-pane');
    const display = document.querySelector('#preview .katex-display');
    if (display) {
      const top = display.offsetTop - (pane.clientHeight - display.offsetHeight) / 2;
      pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  `);
  await at(6500);

  // 4. The skins, changed the way anyone would change them.
  await caption();
  await clickOn('#btn-settings');
  await at(6900);
  await js(`document.querySelector('#pane-appearance .skins').scrollIntoView({ behavior: 'smooth', block: 'center' });`);
  await at(7300);
  for (const [theme, until] of [
    ['nord', 7700],
    ['dracula', 8200],
    ['gruvbox-dark', 8700],
    ['github', 9400],
  ]) {
    await clickOn(`.skin[data-theme='${theme}']`);
    await at(until);
  }
  await clickOn('#settings-close');
  await at(10000);

  await capture.stop();

  // ----------------------------------------------------------------- the gif

  console.log(`captured ${capture.frames.length} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const list = await writeFrameList(capture.frames, frameDir);
  await encodeGif(list, OUT_GIF);
  const { size } = await fsp.stat(OUT_GIF);
  console.log(`wrote ${path.relative(ROOT, OUT_GIF)} — ${(size / 1024).toFixed(0)} KB`);

  if (process.env.JMD_DEMO_KEEP) console.log(`frames kept in ${frameDir}`);
  else await fsp.rm(workDir, { recursive: true, force: true });

  app.quit();
};

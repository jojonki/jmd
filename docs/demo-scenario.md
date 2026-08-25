# jmd demo GIF scenario

## Goal

Show that jmd offers three ways to work with the same Markdown document:

1. Edit Markdown in a focused text editor.
2. Edit Markdown beside a real-time preview.
3. Edit the rendered document directly.

Finish by showing several colour themes and leave the app in a light theme.

## Source document

Use [`docs/demo.md`](demo.md) as the completed document. Open it as
`README.md`, with `# jmd` as its title.

The recording begins with these later edits removed:

- ` — fast and focused.` from the opening sentence
- `- [x] Direct rich-text editing` from the task list
- ` Built for your flow.` from the opening sentence

## Recording

`npm run demo` performs this scenario against the real app and writes
`docs/jmd-demo.gif`; [`scripts/record-demo.cjs`](../scripts/record-demo.cjs) is
where the timings below live. It needs ffmpeg on the PATH, and the machine left
alone for the ten seconds it records — the typing and the clicks go to whichever
window has focus.

Target length: approximately 10 seconds. Keep the window fixed throughout the
recording and use the Nord theme initially. Typing should feel brisk but remain
readable; avoid long pauses between actions.

### 1. Text editor

**Time:** 0:00–0:02  
**Layout:** Editor only  
**Label:** `Text editor` — `Edit Markdown with full focus`

1. Show the Markdown source with the caret at the end of
   `A simple, lightweight Markdown editor`.
2. Hold for about half a second so the source syntax and title are readable.
3. Type ` — fast and focused.` character by character.
4. Move immediately to the next layout when the sentence is complete.

### 2. Editor + Preview

**Time:** 0:02–0:04.2  
**Layout:** Editor + Preview  
**Label:** `Editor + Preview` — `See every change rendered in real time`

1. Switch to the split layout without changing the scroll position.
2. Place the source caret after `- [x] Live preview`.
3. Create a new task-list item and type
   `- [x] Direct rich-text editing` character by character.
4. Keep both panes visible while the rendered checklist updates immediately.
5. Hold the completed item for only a few frames.

### 3. Direct editing in Preview

**Time:** 0:04.2–0:06.5  
**Layout:** Preview only, editing enabled  
**Label:** `Rich-text editor` — `Edit the rendered document directly`

1. Switch to Preview only.
2. Put the caret at the end of the opening sentence in the rendered document.
3. Type ` Built for your flow.` directly into the rendered paragraph.
4. Pause just long enough for the edit to commit back to the Markdown source.
5. Scroll just enough to place the display equation near the centre of the
   window. Hold it for about half a second.

The centred equation should appear as:

$$
\begin{aligned}
\partial_t p_t(x)
&= \partial_t \int p_t(x\mid z)p_{\mathrm{data}}(z)\,dz.
\end{aligned}
$$

### 4. Colour themes

**Time:** 0:06.5–0:09.4  
**Layout:** Settings › Appearance over Preview  
**Label:** none; let the Settings UI identify the themes

1. Click the Settings button in the title bar.
2. Keep **Appearance** selected and scroll the pane until the theme swatches
   are in view.
3. Click the swatches in this order, allowing roughly half a second for each
   change to register visually:
   - **Nord**
   - **Dracula**
   - **Gruvbox Dark**
   - **GitHub Light**
4. Hold GitHub Light slightly longer than the dark themes.
5. Close Settings at approximately 0:09.4.

Theme changes must be performed through the visible Settings interface, not
through shortcuts, menus, or hidden automation hooks.

## Final frame

- Theme: GitHub Light
- Layout: Preview only
- Preview editing: enabled
- Visible content: the display equation and at least part of the mode table
- Settings closed; no dialogs, menus, or transient focus outlines

Hold the clean final Preview from 0:09.4 to 0:10.0, then loop directly back to
the Nord text-editor opening frame.

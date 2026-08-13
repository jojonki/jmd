export const WELCOME = `# jmd

A small markdown editor. Type on the left, read on the right.

Press **⌘E** (Ctrl+E) to edit *directly in the preview* — the markdown source
updates as you go.

## Common syntax

**Bold**, *italic*, ~~struck through~~, ==highlighted==, \`inline code\`,
H~2~O and E=mc^2^, and [links](https://commonmark.org).

- Bullet lists
- With **nested** items
  - like this one
1. Numbered lists
2. Also work

- [x] Task lists are supported
- [ ] Click a checkbox to toggle it

> Block quotes for the parts worth quoting.

| Feature      | Supported |
| ------------ | :-------: |
| Tables       |     ✓     |
| Footnotes[^1]|     ✓     |
| Math         |     ✓     |

[^1]: Footnotes land at the bottom of the document.

## Math

Inline math such as $e^{i\\pi} + 1 = 0$ sits in the flow of a sentence, while
display math gets its own block:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Code

\`\`\`python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

## Images

Relative paths resolve against the folder of the file you have open:

![A local image](./images/example.png)

Remote images work too, and so do \`data:\` URIs.

---

Themes live in the top-right corner. **⌘1 / ⌘2 / ⌘3** switch between editor,
split and preview.
`;

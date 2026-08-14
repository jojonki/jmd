import themesCss from './styles/themes.css?inline';
import markdownCss from './styles/markdown.css?inline';

/**
 * Wrap the rendered preview in a standalone HTML document that carries the
 * current colour theme. KaTeX's stylesheet is linked rather than inlined
 * because its web fonts cannot be embedded without bloating every export.
 */
export function exportDocument({ title, bodyHtml, theme, width = 46 }) {
  return `<!doctype html>
<html lang="en" data-theme="${escapeAttr(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css" crossorigin="anonymous">
<style>
${themesCss}
${markdownCss}
html { background: var(--bg); }
body {
  margin: 0;
  padding: 3rem 1.25rem 6rem;
  background: var(--bg);
  color: var(--fg);
}
.markdown-body { max-width: ${Number(width) || 46}rem; margin: 0 auto; }
::selection { background-color: var(--selection); color: var(--selection-fg); }
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>
`;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const escapeAttr = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

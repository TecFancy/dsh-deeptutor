---
name: html-doc
description: Generates self-contained, browser-ready HTML files from Markdown content (study notes, documentation, quiz/exercise sheets) using a zero-dependency Node converter and a polished built-in template with dark/light theme toggle, collapsible answers, and print-friendly layout. Use when the user wants local HTML output for reading, reviewing, or sharing learning material and docs.
---

# HTML Doc Generator

Convert Markdown into a beautiful, self-contained local HTML file (single file, inline CSS/JS, no network needed to open). Ideal for study notes, knowledge summaries, and self-test question sheets.

## When to Use

- After a learning session (e.g. deeptutor deep_solve / deep_question), the user wants readable local HTML of the knowledge points and quiz questions
- Converting any Markdown notes/docs into a polished local HTML page

## Files

```
html-doc/
├── SKILL.md               # this file
├── scripts/
│   └── md-to-html.js      # zero-dependency Markdown → HTML converter (Node ≥ 20.11)
└── assets/
    └── template.html      # default HTML template (CSS + JS, customizable)
```

## Usage

```bash
# Basic: write Markdown to a file, then convert
node scripts/md-to-html.js notes.md --out notes.html --title "C# 抽象类学习笔记"

# From stdin (any tool output piped in)
cat notes.md | node scripts/md-to-html.js --title "Quiz" --theme dark --out quiz.html

# Options
#   --out <file>     output path (default: <input>.html)
#   --title <text>   page title (default: input filename or "Document")
#   --theme <mode>   dark | light (default: light; user can toggle in-page anyway)
#   --toc            generate a table of contents from headings (h2/h3)
#   --lang <code>    html lang attribute (default: zh-CN)
#   --no-collapse    disable <details> wrapping for quiz answers (default: collapse enabled)
```

## Supported Markdown

ATX headings (`#`–`######`), fenced code blocks (``` with optional language), inline code, bold, italic, links, unordered/ordered lists, task lists (`- [ ]` / `- [x]`), blockquotes, tables (pipe syntax), horizontal rules, paragraphs.

Anything unsupported falls back to a plain `<p>` — output always stays valid.

## Recommended Workflow for Study Material

1. Collect the learning content (e.g. from deeptutor_run answer) as Markdown files under a docs folder, e.g. `~/study/abstract-class/`:
   - `knowledge.md` — the deep-solve explanation
   - `quiz.md` — the self-test questions (mark answers inside `<details>` blocks so they collapse)
2. Convert each file:
   ```bash
   node scripts/md-to-html.js knowledge.md --out knowledge.html --title "C# 抽象类 · 知识点" --toc
   node scripts/md-to-html.js quiz.md --out quiz.html --title "C# 抽象类 · 自测题" --toc
   ```
3. Open the HTML files in the browser (or tell the user the file paths).

## Quiz Answer Collapsing

The converter auto-detects quiz structure: any heading containing "答案" / "Answer" / "解析" / "Explanation" starts a `<details>` block whose following content (until the next heading) is collapsed. Also, a heading line that is immediately followed by content gets wrapped when the heading matches. This keeps the quiz readable while hiding answers until clicked.

To be explicit, authors can also wrap answers manually:

```markdown
<details><summary>答案：C</summary>

解析：...
</details>
```

Raw `<details>`/`<summary>` blocks are preserved as-is (the only raw-HTML passthrough); everything else is treated as Markdown/text and HTML-escaped.

## Customizing the Template

Edit `assets/template.html` — it uses `{{TITLE}}`, `{{BODY}}`, `{{THEME}}`, `{{LANG}}`, `{{TOC}}`, `{{GENERATED}}` placeholders. Keep placeholders intact; the converter does simple string replacement. The built-in template includes:

- CSS variables for light/dark theming with an in-page toggle button (remembers choice in localStorage)
- Print stylesheet (answers stay collapsed on paper)
- Code block styling with optional language badge
- Table styling, blockquote styling, task-list checkboxes
- Responsive layout (comfortable reading column)

## Notes

- Zero dependencies — only `node` (≥ 20.11, uses `import.meta.dirname`) is required; no npm install needed
- Output is fully self-contained: inline CSS + JS, no external fonts/CDN (offline-friendly)
- Escaping is handled: content is HTML-escaped before insertion. Raw-HTML passthrough is intentionally narrow (`<details>`/`<summary>` only) since `deeptutor_run` feeds model/web_search-sourced answers into this converter automatically — a wider tag whitelist would let untrusted `<script>`/`on*=` content ride along into the generated local HTML.

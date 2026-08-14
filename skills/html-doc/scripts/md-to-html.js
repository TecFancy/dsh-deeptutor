#!/usr/bin/env node
/**
 * md-to-html.js — zero-dependency Markdown → self-contained HTML converter.
 *
 * Usage:
 *   node md-to-html.js <input.md> [--out out.html] [--title "T"] [--theme dark|light]
 *                      [--toc] [--lang zh-CN] [--no-collapse]
 *   cat file.md | node md-to-html.js --title "T" --out out.html
 *
 * Features: headings, fenced code blocks, inline code/bold/italic/links, lists,
 * task lists, blockquotes, pipe tables, hr, quiz answer collapsing (<details>),
 * raw HTML passthrough, HTML escaping. Zero npm dependencies (Node >= 22).
 */
"use strict";

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    out: null,
    title: null,
    theme: "light",
    toc: false,
    lang: "zh-CN",
    collapse: true,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--title") opts.title = argv[++i];
    else if (a === "--theme") opts.theme = argv[++i] === "dark" ? "dark" : "light";
    else if (a === "--toc") opts.toc = true;
    else if (a === "--lang") opts.lang = argv[++i];
    else if (a === "--no-collapse") opts.collapse = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else positional.push(a);
  }
  return { opts, positional };
}

function printHelp() {
  console.log(`md-to-html.js — Markdown → self-contained HTML

Usage:
  node md-to-html.js <input.md> [options]
  cat file.md | node md-to-html.js [options]

Options:
  --out <file>     output path (default: <input>.html, or stdout when stdin)
  --title <text>   page title (default: input filename or "Document")
  --theme <mode>   dark | light (default: light; toggle also available in page)
  --toc            generate a table of contents from h2/h3 headings
  --lang <code>    html lang attribute (default: zh-CN)
  --no-collapse    disable quiz-answer collapsing
  --help           show this help`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline formatting: `code`, **bold**, *italic*, [text](url), ~~strike~~ */
function inline(text) {
  // Protect already-raw-HTML spans? We escape everything except explicit HTML
  // blocks, so inline HTML is escaped (safe default). Code spans first:
  let out = "";
  const parts = text.split(/(`[^`\n]+`)/g);
  for (const p of parts) {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 1) {
      out += `<code>${esc(p.slice(1, -1))}</code>`;
    } else {
      out += esc(p)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(
          /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>',
        );
    }
  }
  return out;
}

/** Split a pipe-table row into cells, honoring escaped pipes. */
function splitRow(line) {
  const l = line.trim().replace(/^\||\|$/g, "");
  return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isTableSep = (cells) =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------
function parse(md, opts) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const body = [];
  const toc = [];
  let i = 0;

  // Heading regex incl. optional trailing closing #s
  const hRe = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  // Quiz-answer heading (collapsed <details>)
  const ansRe = /^(#{1,6})\s+(.*(?:答案|解答|解析|Answer|Explanation|Solution).*)$/i;

  const flushList = (list) => {
    const tag = list.ordered ? "ol" : "ul";
    let html = `<${tag}>\n`;
    for (const item of list.items) {
      html +=
        item.task !== null
          ? `<li class="task${item.task ? " done" : ""}"><input type="checkbox"${item.task ? " checked" : ""} disabled> ${item.html}</li>\n`
          : `<li>${item.html}</li>\n`;
    }
    html += `</${tag}>`;
    body.push(html);
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = (line.match(/^```\s*([^\s]+)?/) || [])[1] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      body.push(
        `<pre class="code-block${lang ? " has-lang" : ""}"><span class="lang-badge">${esc(lang)}</span><code>${esc(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Raw HTML block: only the quiz-answer <details>/<summary> convention passes through
    // unescaped. Kept narrow on purpose — deeptutor_run feeds model/web_search-sourced
    // answers into this converter automatically, so a wider tag whitelist (div/table/p/...)
    // would let untrusted <script>/on*= content ride along into the generated local HTML.
    if (/^<(details|summary)\b/i.test(line.trim())) {
      const tag = /^<details\b/i.test(line.trim()) ? "details" : "summary";
      const closeRe = new RegExp(`</${tag}>`, "i");
      const buf = [line];
      i++;
      // Collect until the matching closing tag, not the first blank line/heading — the body
      // of a <details> block is free-form text and commonly contains blank lines.
      if (!closeRe.test(line)) {
        while (i < lines.length && !closeRe.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          buf.push(lines[i]);
          i++;
        }
      }
      body.push(buf.join("\n"));
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      body.push("<hr>");
      i++;
      continue;
    }

    // Heading
    if (hRe.test(line)) {
      const m = line.match(hRe);
      const level = m[1].length;
      const text = m[2].trim();
      const slug = `h-${body.length}-${
        text
          .toLowerCase()
          .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
          .replace(/^-+|-+$/g, "") || "sec"
      }`;
      if (opts.toc && level <= 3) toc.push({ level, text, slug });
      const inner = inline(text);

      if (opts.collapse && ansRe.test(line) && level >= 2) {
        // Quiz answer: start a <details> block; collect until next heading
        const titleInner = inner.replace(
          /^(答案与解析|答案解析|答案|解答|解析|Answer|Explanation|Solution)\s*[:：]?\s*/i,
          "",
        );
        const buf = [
          `<details class="answer"><summary><span class="answer-tag">答案</span>${titleInner}</summary>`,
          '<div class="answer-body">',
        ];
        i++;
        while (i < lines.length && !hRe.test(lines[i]) && !/^```/.test(lines[i])) {
          const l = lines[i];
          if (l.trim() === "") {
            buf.push("");
            i++;
            continue;
          }
          buf.push(`<p>${inline(l)}</p>`);
          i++;
        }
        buf.push("</div></details>");
        body.push(buf.join("\n"));
        continue;
      }

      body.push(`<h${level} id="${slug}">${inner}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      body.push(
        `<blockquote>${parse(buf.join("\n"), { ...opts, collapse: false }).html}</blockquote>`,
      );
      continue;
    }

    // List (ul/ol/task)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const list = { ordered: /^\s*\d+\.\s+/.test(line), items: [] };
      const indentRe = /^(\s*)/;
      const baseIndent = (line.match(indentRe) || ["", ""])[1].length;
      const isTaskRe = /^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.*)$/;

      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const cur = lines[i];
        const indent = (cur.match(indentRe) || ["", ""])[1].length;
        if (indent > baseIndent) {
          /* nested list: keep simple, treat as continuation */
        }
        const tm = cur.match(isTaskRe);
        if (tm) {
          list.items.push({ task: tm[3].toLowerCase() === "x", html: inline(tm[4]) });
        } else {
          const content = cur.replace(/^\s*([-*+]|\d+\.)\s+/, "");
          list.items.push({ task: null, html: inline(content) });
        }
        i++;
      }
      flushList(list);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && isTableSep(splitRow(lines[i + 1]))) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let html = `<div class="table-wrap"><table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`;
      for (const r of rows) html += `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      html += "</tbody></table></div>";
      body.push(html);
      continue;
    }

    // Paragraph (collect consecutive lines)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !hRe.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    body.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return { html: body.join("\n"), toc };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const inputFile = positional[0] || null;

  let md, baseName;
  if (inputFile) {
    md = fs.readFileSync(inputFile, "utf8");
    baseName = path.basename(inputFile, path.extname(inputFile));
  } else {
    md = fs.readFileSync(0, "utf8"); // stdin
    baseName = "document";
  }

  const title = opts.title || baseName;
  const { html, toc } = parse(md, opts);

  const tocHtml =
    opts.toc && toc.length
      ? `<nav class="toc"><h2>目录</h2><ul>${toc.map((t) => `<li class="toc-l${t.level}"><a href="#${t.slug}">${esc(t.text)}</a></li>`).join("")}</ul></nav>`
      : "";

  const generated = new Date().toISOString().slice(0, 10);
  const templatePath = path.join(import.meta.dirname, "..", "assets", "template.html");
  let template = fs.readFileSync(templatePath, "utf8");
  template = template
    .replace(/\{\{TITLE\}\}/g, esc(title))
    .replace(/\{\{BODY\}\}/g, html)
    .replace(/\{\{TOC\}\}/g, tocHtml)
    .replace(/\{\{THEME\}\}/g, opts.theme)
    .replace(/\{\{LANG\}\}/g, opts.lang)
    .replace(/\{\{GENERATED\}\}/g, generated);

  if (opts.out) {
    fs.writeFileSync(opts.out, template, "utf8");
    console.log(
      `[html-doc] wrote ${path.resolve(opts.out)} (${Buffer.byteLength(template)} bytes)`,
    );
  } else {
    process.stdout.write(template);
  }
}

main();

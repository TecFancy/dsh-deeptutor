/**
 * DeepTutor bridge: render a learning answer to a self-contained local HTML file
 * via the bundled zero-dependency Node converter (scripts/md-to-html.js, from
 * the html-doc skill). Kept as a standalone module (node built-ins only).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the bundled md-to-html converter script. */
export const HTML_DOC_SCRIPT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "scripts",
  "md-to-html.js",
);

/**
 * Render a learning answer to a self-contained local HTML file (dark/light toggle,
 * TOC, collapsible quiz answers, print-friendly). Also writes the companion .md
 * source next to the html file.
 *
 * Returns a short status note to append to the tool result ("" when no html path
 * given; "[html] ✗ …" note when rendering fails — never throws).
 */
export async function renderHtml(
  params: { html?: string; html_title?: string },
  answer: string,
): Promise<string> {
  const out = params.html;
  if (!out) return "";
  const htmlPath = extname(out).toLowerCase() === ".html" ? resolve(out) : resolve(out + ".html");
  const mdPath = htmlPath.slice(0, -extname(htmlPath).length) + ".md";
  const title = params.html_title || basename(htmlPath, extname(htmlPath));
  try {
    if (!existsSync(HTML_DOC_SCRIPT)) {
      return `\n[html] ✗ html-doc converter not found: ${HTML_DOC_SCRIPT}`;
    }
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(mdPath, answer || "(no answer)", "utf8");
    await new Promise<void>((res, rej) => {
      execFile(
        process.execPath,
        [HTML_DOC_SCRIPT, mdPath, "--out", htmlPath, "--title", title, "--toc"],
        { windowsHide: true, timeout: 60_000 },
        (err, _stdout, stderr) => (err ? rej(new Error(stderr || err.message)) : res()),
      );
    });
    return `\n[html] ✓ rendered (html-doc skill)\n[html]   page: ${htmlPath}\n[html]   source: ${mdPath}`;
  } catch (err: any) {
    return `\n[html] ✗ rendering failed: ${err?.message ?? String(err)}`;
  }
}

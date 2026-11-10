/**
 * DeepTutor bridge: render a learning answer to a self-contained local HTML file
 * via the zero-dependency Node converter (scripts/md-to-html.js, from the
 * html-doc skill). Kept as a standalone module (node built-ins only).
 *
 * Two things are resolved at call time, first hit wins, and both are reported in
 * the tool note so the order is visible without reading this file:
 *
 *   converter  $HTML_DOC_SCRIPT
 *              → <DSH_HOME>/skills/html-doc/scripts/md-to-html.js (installed skill)
 *              → the bundled package copy
 *   template   $HTML_DOC_TEMPLATE
 *              → <DSH_HOME>/skills/html-doc/assets/template.html (installed skill)
 *              → the bundled package template
 *
 * <DSH_HOME> is `$DSH_HOME` or `~/.dsh` (same rule as scripts/install-profile.mjs),
 * and `<DSH_HOME>/skills/<name>/` is where that installer copies the bundled
 * skills for dsh auto-discovery. Preferring the installed copy means editing the
 * installed html-doc template (say, wiring KaTeX in) changes `deeptutor_run`'s
 * HTML immediately, instead of requiring edits to two files inside the plugin
 * package that the next upgrade overwrites.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Absolute path to the bundled md-to-html converter (the last-resort fallback). */
export const HTML_DOC_SCRIPT = join(PKG_ROOT, "scripts", "md-to-html.js");

/** Bundled html-doc template, shipped inside the package's copy of the skill. */
const BUNDLED_TEMPLATE = join(PKG_ROOT, ".agents", "skills", "html-doc", "assets", "template.html");

/** dsh home: `$DSH_HOME`, else `~/.dsh` (mirrors scripts/install-profile.mjs). */
export function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
}

/** `<DSH_HOME>/skills/html-doc/<segments…>` — the installer's auto-discovered skill. */
function installedSkill(...segments: string[]): string {
  return join(dshHome(), "skills", "html-doc", ...segments);
}

export type Resolution =
  | { ok: true; path: string; source: string }
  | { ok: false; error: string };

/**
 * Resolve the converter: explicit `$HTML_DOC_SCRIPT`, the installed html-doc
 * skill, then the package copy. A set-but-missing override is an error — a typo
 * must not silently fall through to a different converter.
 */
export function resolveHtmlDocScript(): Resolution {
  const explicit = process.env.HTML_DOC_SCRIPT?.trim();
  if (explicit) {
    return existsSync(explicit)
      ? { ok: true, path: explicit, source: "HTML_DOC_SCRIPT" }
      : { ok: false, error: `HTML_DOC_SCRIPT points at a missing file: ${explicit}` };
  }
  const installed = installedSkill("scripts", "md-to-html.js");
  if (existsSync(installed)) return { ok: true, path: installed, source: "installed skill" };
  if (existsSync(HTML_DOC_SCRIPT)) return { ok: true, path: HTML_DOC_SCRIPT, source: "bundled package" };
  return {
    ok: false,
    error: `html-doc converter not found (looked in: HTML_DOC_SCRIPT, ${installed}, ${HTML_DOC_SCRIPT})`,
  };
}

/**
 * Resolve the HTML template: explicit `$HTML_DOC_TEMPLATE`, the installed
 * html-doc skill, then the package copy. A set-but-missing override is an error.
 */
export function resolveHtmlDocTemplate(): Resolution {
  const explicit = process.env.HTML_DOC_TEMPLATE?.trim();
  if (explicit) {
    return existsSync(explicit)
      ? { ok: true, path: explicit, source: "HTML_DOC_TEMPLATE" }
      : { ok: false, error: `HTML_DOC_TEMPLATE points at a missing file: ${explicit}` };
  }
  const installed = installedSkill("assets", "template.html");
  if (existsSync(installed)) return { ok: true, path: installed, source: "installed skill" };
  if (existsSync(BUNDLED_TEMPLATE)) return { ok: true, path: BUNDLED_TEMPLATE, source: "bundled package" };
  return {
    ok: false,
    error: `html-doc template not found (looked in: HTML_DOC_TEMPLATE, ${installed}, ${BUNDLED_TEMPLATE})`,
  };
}

/**
 * Why `html` cannot be a relative path (null when it is acceptable).
 *
 * A tool has no workspace root: dsh hands `execute` only the agent identity
 * (`exec.agent.id`) plus the call's signal, and the MCP server has no session at
 * all, so a relative path could only resolve against the host process cwd — the
 * dsh config directory, not the caller's project. Requiring an absolute path is
 * the one contract that can never write somewhere unexpected.
 */
export function htmlTargetProblem(out: string): string | null {
  if (isAbsolute(out.trim())) return null;
  return (
    `html must be an absolute path, got "${out}". Nothing was rendered: this tool cannot ` +
    `resolve a relative path against your working directory (it has no workspace root, so a ` +
    `relative path would land under the host process cwd instead). Prefix it with your working ` +
    `directory, e.g. "<workspace>/data/study/topic/knowledge.html".`
  );
}

/**
 * Extra CLI flag for the converter. The converter already picks up the template
 * sitting next to it, so only pass `--template` when the resolved template is
 * not that sibling — a plain bundled or installed run stays flag-free, and older
 * converter copies that predate `--template` keep working on their own layout.
 */
function templateArgs(scriptPath: string, templatePath: string): string[] {
  const native = resolve(join(dirname(scriptPath), "..", "assets", "template.html"));
  return native === resolve(templatePath) ? [] : ["--template", templatePath];
}

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
  const problem = htmlTargetProblem(out);
  if (problem) return `\n[html] ✗ ${problem}`;
  const target = out.trim();
  const htmlPath =
    extname(target).toLowerCase() === ".html" ? resolve(target) : resolve(target + ".html");
  const mdPath = htmlPath.slice(0, -extname(htmlPath).length) + ".md";
  const title = params.html_title || basename(htmlPath, extname(htmlPath));
  const script = resolveHtmlDocScript();
  if (!script.ok) return `\n[html] ✗ ${script.error}`;
  const template = resolveHtmlDocTemplate();
  if (!template.ok) return `\n[html] ✗ ${template.error}`;
  try {
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(mdPath, answer || "(no answer)", "utf8");
    const argv = [script.path, mdPath, "--out", htmlPath, "--title", title, "--toc"];
    await new Promise<void>((res, rej) => {
      execFile(
        process.execPath,
        [...argv, ...templateArgs(script.path, template.path)],
        { windowsHide: true, timeout: 60_000 },
        (err, _stdout, stderr) => (err ? rej(new Error(stderr || err.message)) : res()),
      );
    });
    return (
      `\n[html] ✓ rendered (html-doc skill)` +
      `\n[html]   page: ${htmlPath}` +
      `\n[html]   source: ${mdPath}` +
      `\n[html]   converter: ${script.path} (${script.source})` +
      `\n[html]   template: ${template.path} (${template.source})`
    );
  } catch (err: any) {
    return `\n[html] ✗ rendering failed: ${err?.message ?? String(err)}`;
  }
}

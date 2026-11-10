import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  dshHome,
  htmlTargetProblem,
  renderHtml,
  resolveHtmlDocScript,
  resolveHtmlDocTemplate,
} from "../src/html-render.ts";
import { TOOLS } from "../src/tools.ts";

const TEMPLATE = (marker: string) =>
  `<html><head><title>{{TITLE}}</title></head><body ${marker}>{{TOC}}{{BODY}}</body></html>`;

/**
 * Point the resolvers at an empty dsh home and clear both overrides, so the
 * machine's real `~/.dsh/skills/html-doc/` never decides a test outcome.
 */
function isolate(): string {
  const home = mkdtempSync(join(tmpdir(), "dt-html-home-"));
  process.env.DSH_HOME = home;
  delete process.env.HTML_DOC_SCRIPT;
  delete process.env.HTML_DOC_TEMPLATE;
  return home;
}

/** Write a template into the installed-skill layout under `home`. */
function installTemplate(home: string, marker: string): string {
  const file = join(home, "skills", "html-doc", "assets", "template.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TEMPLATE(marker), "utf8");
  return file;
}

/** A stand-in converter that stamps which layer supplied it. */
function fakeConverter(file: string, marker: string): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      'import fs from "node:fs";',
      "const argv = process.argv.slice(2);",
      "const out = argv[argv.indexOf('--out') + 1];",
      `fs.writeFileSync(out, '<html ${marker}="custom"></html>', 'utf8');`,
    ].join("\n"),
    "utf8",
  );
  return file;
}

test("renderHtml returns an empty note when no html path is given", async () => {
  isolate();
  assert.equal(await renderHtml({}, "answer"), "");
});

test("html must be an absolute path (nothing is written for a relative one)", async () => {
  isolate();
  const relative = `dt-relative-${process.pid}-${Date.now()}/knowledge.html`;
  const note = await renderHtml({ html: relative }, "answer");
  assert.match(note, /\[html\] ✗/);
  assert.match(note, /must be an absolute path/);
  assert.equal(existsSync(join(process.cwd(), relative)), false, "no file under the host cwd");
  assert.equal(existsSync(join(process.cwd(), relative.replace(/\.html$/, ".md"))), false);
});

test("deeptutor_run rejects a non-absolute html path before running the turn", async () => {
  isolate();
  const run = TOOLS.find((t) => t.name === "deeptutor_run")!;
  await assert.rejects(
    () =>
      run.execute(
        { capability: "chat", prompt: "hi", html: "data/study/x/knowledge.html" },
        new AbortController().signal,
      ),
    /must be an absolute path/,
  );
});

test("htmlTargetProblem accepts absolute paths only", () => {
  assert.equal(htmlTargetProblem(join(tmpdir(), "a", "b.html")), null);
  assert.match(htmlTargetProblem("data/study/x/knowledge.html") ?? "", /must be an absolute path/);
  assert.match(htmlTargetProblem("") ?? "", /must be an absolute path/);
});

test("renderHtml writes a companion .md and a self-contained .html page", async () => {
  isolate();
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "study", "topic", "knowledge.html");
  const note = await renderHtml({ html: out, html_title: "测试主题" }, "# 标题\n\n内容段落。");
  assert.match(note, /\[html\] ✓ rendered/);
  assert.match(note, /converter: .*\(bundled package\)/);
  assert.match(note, /template: .*\(bundled package\)/);
  assert.ok(existsSync(out));
  assert.ok(existsSync(join(dir, "study", "topic", "knowledge.md")));
  const md = readFileSync(join(dir, "study", "topic", "knowledge.md"), "utf8");
  assert.match(md, /内容段落/);
  const html = readFileSync(out, "utf8");
  assert.match(html, /<title>测试主题<\/title>/);
  assert.match(html, /<h1 id="h-0-标题">标题<\/h1>/);
  assert.match(html, /内容段落/);
});

test("the installed html-doc template beats the bundled one", async () => {
  const home = isolate();
  installTemplate(home, 'data-template="installed"');
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "k.html");
  const note = await renderHtml({ html: out }, "# 标题\n\n内容。");
  assert.match(note, /\[html\] ✓ rendered/);
  assert.match(note, /template: .*skills[\\/]html-doc[\\/]assets[\\/]template\.html \(installed skill\)/);
  const html = readFileSync(out, "utf8");
  assert.match(html, /data-template="installed"/);
  assert.match(html, /<h1 id="h-0-标题">标题<\/h1>/);
});

test("HTML_DOC_TEMPLATE beats the installed template, and a missing one is an error", async () => {
  const home = isolate();
  installTemplate(home, 'data-template="installed"');
  const custom = join(home, "custom", "template.html");
  mkdirSync(dirname(custom), { recursive: true });
  writeFileSync(custom, TEMPLATE('data-template="env"'), "utf8");
  process.env.HTML_DOC_TEMPLATE = custom;
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "k.html");
  const note = await renderHtml({ html: out }, "# 标题");
  assert.match(note, /template: .*custom[\\/]template\.html \(HTML_DOC_TEMPLATE\)/);
  assert.match(readFileSync(out, "utf8"), /data-template="env"/);

  process.env.HTML_DOC_TEMPLATE = join(home, "custom", "absent.html");
  const failed = await renderHtml({ html: join(dir, "x.html") }, "# 标题");
  assert.match(failed, /\[html\] ✗ HTML_DOC_TEMPLATE points at a missing file/);
});

test("HTML_DOC_SCRIPT beats the installed skill converter", async () => {
  const home = isolate();
  const fake = fakeConverter(join(home, "fake-converter.js"), 'data-converter');
  // An installed converter is present too, and must lose to the explicit override.
  fakeConverter(join(home, "skills", "html-doc", "scripts", "md-to-html.js"), 'data-converter');
  process.env.HTML_DOC_SCRIPT = fake;
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "k.html");
  const note = await renderHtml({ html: out }, "# 标题");
  assert.match(note, /converter: .*fake-converter\.js \(HTML_DOC_SCRIPT\)/);
  assert.match(readFileSync(out, "utf8"), /data-converter="custom"/);

  process.env.HTML_DOC_SCRIPT = join(home, "absent.js");
  const failed = await renderHtml({ html: join(dir, "y.html") }, "# 标题");
  assert.match(failed, /\[html\] ✗ HTML_DOC_SCRIPT points at a missing file/);
});

test("the installed skill converter is used when present", async () => {
  const home = isolate();
  fakeConverter(join(home, "skills", "html-doc", "scripts", "md-to-html.js"), 'data-converter');
  installTemplate(home, 'data-template="installed"');
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "k.html");
  const note = await renderHtml({ html: out }, "# 标题");
  assert.match(note, /converter: .*skills[\\/]html-doc[\\/]scripts[\\/]md-to-html\.js \(installed skill\)/);
  assert.match(readFileSync(out, "utf8"), /data-converter="custom"/);
});

test("resolution helpers fall back to the package copy on an empty dsh home", () => {
  const home = isolate();
  const script = resolveHtmlDocScript();
  assert.equal(script.ok, true);
  assert.equal(script.ok ? script.source : null, "bundled package");
  const template = resolveHtmlDocTemplate();
  assert.equal(template.ok, true);
  assert.equal(template.ok ? template.source : null, "bundled package");
  // dshHome mirrors scripts/install-profile.mjs: DSH_HOME when set, else ~/.dsh.
  assert.equal(dshHome(), home);
});

test("renderHtml never throws when rendering", async () => {
  isolate();
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const note = await renderHtml({ html: join(dir, "x.html") }, "answer");
  assert.match(note, /\[html\] (✓|✗)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/md-to-html.js", import.meta.url));

function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // Blank out any inherited HTML_DOC_TEMPLATE so the machine running the tests
    // cannot change which template a case resolves.
    const childEnv = { ...process.env, HTML_DOC_TEMPLATE: "", ...env };
    execFile(process.execPath, [SCRIPT, ...args], { env: childEnv }, (err, stdout, stderr) => {
      const e = err as NodeJS.ErrnoException | null;
      resolve({ stdout, stderr, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 });
    });
  });
}

const TEMPLATE = (marker: string) =>
  `<html><head><title>{{TITLE}}</title></head><body ${marker}>{{TOC}}{{BODY}}</body></html>`;

function writeTemplate(dir: string, name: string, marker: string): string {
  const file = join(dir, name);
  writeFileSync(file, TEMPLATE(marker), "utf8");
  return file;
}

test("md-to-html converts headings, tables and quiz answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "fixture.md");
  const outPath = join(dir, "out.html");
  writeFileSync(
    mdPath,
    "# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## 答案与解析\n\n这是答案。\n",
    "utf8",
  );
  const { code, stderr } = await runCli([mdPath, "--out", outPath]);
  assert.equal(code, 0, stderr);
  const html = readFileSync(outPath, "utf8");
  assert.match(html, /<h1 id="h-0-标题">标题<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /<details class="answer">/);
  assert.match(html, /这是答案。/);
});

test("md-to-html escapes HTML in markdown by default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "x.md");
  const outPath = join(dir, "x.html");
  writeFileSync(mdPath, "去 <script>alert(1)</script> 试试\n", "utf8");
  const { code } = await runCli([mdPath, "--out", outPath]);
  assert.equal(code, 0);
  const html = readFileSync(outPath, "utf8");
  assert.ok(!html.includes("<script>alert"));
  assert.match(html, /&lt;script&gt;/);
});

test("md-to-html renders a toc from headings with --toc", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "t.md");
  const outPath = join(dir, "t.html");
  writeFileSync(mdPath, "# 主标题\n\n## 小节\n\n内容\n", "utf8");
  const { code } = await runCli([mdPath, "--out", outPath, "--toc"]);
  assert.equal(code, 0);
  const html = readFileSync(outPath, "utf8");
  assert.match(html, /<nav class="toc">/);
  assert.match(html, /href="#h-1-小节"/);
});

test("md-to-html fails when a value flag is missing its value", async () => {
  const { code, stderr } = await runCli(["--out"]);
  assert.equal(code, 1);
  assert.match(stderr, /Missing value for --out/);
});

test("md-to-html fails on unknown options instead of ignoring them", async () => {
  const { code, stderr } = await runCli(["--bogus"]);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown option: --bogus/);
});

test("md-to-html fails on an invalid --theme value", async () => {
  const { code, stderr } = await runCli(["--theme", "blue"]);
  assert.equal(code, 1);
  assert.match(stderr, /Invalid --theme value "blue"/);
});

test("md-to-html --no-collapse keeps quiz answers as plain headings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "q.md");
  const outPath = join(dir, "q.html");
  writeFileSync(mdPath, "## 答案\n\n答案内容\n", "utf8");
  const { code } = await runCli([mdPath, "--out", outPath, "--no-collapse"]);
  assert.equal(code, 0);
  const html = readFileSync(outPath, "utf8");
  assert.ok(!html.includes('<details class="answer">'));
  assert.match(html, /<h2/);
});

test("md-to-html inserts body, title and toc verbatim (no $-pattern expansion)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "d.md");
  const outPath = join(dir, "d.html");
  writeFileSync(
    mdPath,
    [
      "# Cost $& more",
      "",
      "Display math: $$x^2$$ and the PID $$.",
      "",
      "```",
      "s.replace(/a/, \"[$&]\"); s.replace(/a/, \"$'\"); s.replace(/a/, \"$`\");",
      "```",
      "",
      "Template syntax looks like {{TOC}} and {{THEME}}.",
      "",
    ].join("\n"),
    "utf8",
  );
  const { code, stderr } = await runCli([mdPath, "--out", outPath, "--toc", "--title", "T $$ $&"]);
  assert.equal(code, 0, stderr);
  const html = readFileSync(outPath, "utf8");
  assert.ok(html.includes("$$x^2$$"), "display math $$ kept");
  assert.ok(html.includes("the PID $$."), "lone $$ kept");
  assert.ok(html.includes("[$&amp;]"), "$& kept in code");
  assert.ok(html.includes("$&#39;") || html.includes("$'"), "$' kept in code");
  assert.ok(html.includes("$`"), "$` kept in code");
  assert.ok(html.includes("{{TOC}} and {{THEME}}"), "placeholder-like body text not substituted");
  assert.ok(html.includes("<title>T $$ $&amp;</title>"), "title kept");
  assert.ok(html.includes(">Cost $&amp; more</a>"), "toc entry kept");
  assert.ok(!html.includes("{{BODY}}"), "no leaked placeholder");
});

test("md-to-html uses the --template file instead of the built-in template", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "t.md");
  const outPath = join(dir, "t.html");
  writeFileSync(mdPath, "# 标题\n\n内容\n", "utf8");
  const template = writeTemplate(dir, "custom.html", 'data-template="flag"');
  const { code, stdout, stderr } = await runCli([mdPath, "--out", outPath, "--template", template]);
  assert.equal(code, 0, stderr);
  const html = readFileSync(outPath, "utf8");
  assert.match(html, /data-template="flag"/);
  assert.match(html, /<h1 id="h-0-标题">标题<\/h1>/);
  assert.match(stdout, /template: .*custom\.html/, "the resolved template is reported");
});

test("md-to-html honours HTML_DOC_TEMPLATE, and --template beats it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "t.md");
  writeFileSync(mdPath, "# 标题\n", "utf8");
  const envTemplate = writeTemplate(dir, "env.html", 'data-template="env"');
  const flagTemplate = writeTemplate(dir, "flag.html", 'data-template="flag"');

  const fromEnv = join(dir, "env-out.html");
  const envRun = await runCli([mdPath, "--out", fromEnv], { HTML_DOC_TEMPLATE: envTemplate });
  assert.equal(envRun.code, 0, envRun.stderr);
  assert.match(readFileSync(fromEnv, "utf8"), /data-template="env"/);

  const fromFlag = join(dir, "flag-out.html");
  const flagRun = await runCli([mdPath, "--out", fromFlag, "--template", flagTemplate], {
    HTML_DOC_TEMPLATE: envTemplate,
  });
  assert.equal(flagRun.code, 0, flagRun.stderr);
  assert.match(readFileSync(fromFlag, "utf8"), /data-template="flag"/);
});

test("md-to-html fails loudly when the requested template does not exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-md-test-"));
  const mdPath = join(dir, "t.md");
  writeFileSync(mdPath, "# 标题\n", "utf8");

  const flagRun = await runCli([mdPath, "--out", join(dir, "a.html"), "--template", join(dir, "absent.html")]);
  assert.equal(flagRun.code, 1);
  assert.match(flagRun.stderr, /template not found: .*absent\.html \(from --template\)/);

  const envRun = await runCli([mdPath, "--out", join(dir, "b.html")], {
    HTML_DOC_TEMPLATE: join(dir, "absent-env.html"),
  });
  assert.equal(envRun.code, 1);
  assert.match(envRun.stderr, /template not found: .*absent-env\.html \(from HTML_DOC_TEMPLATE\)/);
});

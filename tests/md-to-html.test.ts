import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/md-to-html.js", import.meta.url));

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], (err, stdout, stderr) => {
      const e = err as NodeJS.ErrnoException | null;
      resolve({ stdout, stderr, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 });
    });
  });
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

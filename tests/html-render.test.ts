import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHtml } from "../src/html-render.ts";

test("renderHtml returns an empty note when no html path is given", async () => {
  assert.equal(await renderHtml({}, "answer"), "");
});

test("renderHtml writes a companion .md and a self-contained .html page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const out = join(dir, "study", "topic", "knowledge.html");
  const note = await renderHtml({ html: out, html_title: "测试主题" }, "# 标题\n\n内容段落。");
  assert.match(note, /\[html\] ✓ rendered/);
  assert.ok(existsSync(out));
  assert.ok(existsSync(join(dir, "study", "topic", "knowledge.md")));
  const md = readFileSync(join(dir, "study", "topic", "knowledge.md"), "utf8");
  assert.match(md, /内容段落/);
  const html = readFileSync(out, "utf8");
  assert.match(html, /<title>测试主题<\/title>/);
  assert.match(html, /<h1 id="h-0-标题">标题<\/h1>/);
  assert.match(html, /内容段落/);
});

test("renderHtml never throws when rendering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dt-html-test-"));
  const note = await renderHtml({ html: join(dir, "x.html") }, "answer");
  assert.match(note, /\[html\] (✓|✗)/);
});

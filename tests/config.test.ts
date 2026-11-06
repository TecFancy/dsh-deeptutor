import { test } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../src/config.ts";

test("truncate keeps short strings unchanged", () => {
  assert.equal(truncate("hello", 100), "hello");
});

test("truncate shortens long strings and reports the original length", () => {
  const long = "a".repeat(200);
  const out = truncate(long, 100);
  assert.ok(out.startsWith("a".repeat(100)));
  assert.match(out, /…\[truncated, 200 chars total\]/);
});

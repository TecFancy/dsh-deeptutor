import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, truncate } from "../src/config.ts";

test("truncate keeps short strings unchanged", () => {
  assert.equal(truncate("hello", 100), "hello");
});

test("truncate shortens long strings and reports the original length", () => {
  const long = "a".repeat(200);
  const out = truncate(long, 100);
  assert.ok(out.startsWith("a".repeat(100)));
  assert.match(out, /…\[truncated, 200 chars total\]/);
});

test("CAPABILITIES covers the documented learning capabilities", () => {
  assert.deepEqual(CAPABILITIES, [
    "chat",
    "deep_solve",
    "deep_question",
    "deep_research",
    "visualize",
    "math_animator",
    "mastery_path",
  ]);
});

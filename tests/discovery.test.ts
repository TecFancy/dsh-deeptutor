import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeCapabilities,
  discoverCapabilities,
  indexCapabilities,
  parseModuleList,
  resetCapabilityCache,
} from "../src/discovery.ts";

// Trimmed from a real DeepTutor 1.7.1 `deeptutor module list`.
const MODULE_LIST = JSON.stringify([
  { id: "core", installed: true, enabled: true, ready: true, issues: [], capabilities: ["chat", "ask_questions"] },
  { id: "solve", installed: true, enabled: true, ready: true, issues: [], capabilities: ["deep_solve"] },
  { id: "audio-overview", installed: true, enabled: true, ready: true, issues: [], capabilities: ["audio_overview"] },
  { id: "renderer-manim", installed: false, enabled: false, ready: false, issues: [], capabilities: ["math_animator"] },
  { id: "knowledge", installed: true, enabled: true, ready: true, issues: [], capabilities: [] },
]);

test("parseModuleList reads the JSON array and tolerates leading noise", () => {
  const mods = parseModuleList("some banner\n" + MODULE_LIST);
  assert.equal(mods?.length, 5);
  assert.deepEqual(mods?.[3], { id: "renderer-manim", ready: false, capabilities: ["math_animator"], issues: [] });
});

test("parseModuleList returns undefined for non-JSON output", () => {
  assert.equal(parseModuleList("Usage: deeptutor [OPTIONS]"), undefined);
  assert.equal(parseModuleList("[not json"), undefined);
});

test("indexCapabilities splits ready from unavailable, including new capabilities", () => {
  const idx = indexCapabilities(parseModuleList(MODULE_LIST)!);
  assert.deepEqual(idx.ready, ["ask_questions", "audio_overview", "chat", "deep_solve"]);
  assert.deepEqual(Object.keys(idx.unavailable), ["math_animator"]);
  assert.equal(idx.unavailable.math_animator.module, "renderer-manim");
});

test("a capability provided by any ready module is not reported unavailable", () => {
  const idx = indexCapabilities([
    { id: "a", ready: false, capabilities: ["x"], issues: ["missing dep"] },
    { id: "b", ready: true, capabilities: ["x"], issues: [] },
  ]);
  assert.deepEqual(idx.ready, ["x"]);
  assert.deepEqual(idx.unavailable, {});
});

test("discoverCapabilities caches for five minutes and gives up quietly on failure", async () => {
  resetCapabilityCache();
  let calls = 0;
  let clock = 0;
  const run = async () => {
    calls++;
    return { stdout: MODULE_LIST, stderr: "", code: 0, killed: false };
  };
  const now = () => clock;
  await discoverCapabilities(undefined, run, now);
  clock += 60_000;
  await discoverCapabilities(undefined, run, now);
  assert.equal(calls, 1);
  clock += 5 * 60_000;
  await discoverCapabilities(undefined, run, now);
  assert.equal(calls, 2);

  resetCapabilityCache();
  const failing = async () => ({ stdout: "", stderr: "No such command 'module'", code: 2, killed: false });
  assert.equal(await discoverCapabilities(undefined, failing, now), undefined);
  resetCapabilityCache();
});

test("describeCapabilities lists ready and not-ready capabilities", () => {
  const text = describeCapabilities(indexCapabilities(parseModuleList(MODULE_LIST)!));
  assert.match(text, /Available capabilities: ask_questions, audio_overview, chat, deep_solve/);
  assert.match(text, /math_animator \(module renderer-manim/);
  assert.match(describeCapabilities(undefined), /unknown/);
});

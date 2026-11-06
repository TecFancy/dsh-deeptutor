import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCliArgs, commandPath } from "../src/cli-policy.ts";

const tier = (...args: string[]) => classifyCliArgs(args).tier;

test("commandPath stops at the first option", () => {
  assert.deepEqual(commandPath(["kb", "search", "dotnet", "q", "--mode", "hybrid"]), ["kb", "search", "dotnet", "q"]);
  assert.deepEqual(commandPath(["--help"]), []);
});

test("help is always read-only, even on destructive or interactive commands", () => {
  assert.equal(tier(), "read");
  assert.equal(tier("--help"), "read");
  assert.equal(tier("kb", "delete", "--help"), "read");
  assert.equal(tier("chat", "-h"), "read");
});

test("read verbs run directly", () => {
  assert.equal(tier("kb", "list", "--format", "json"), "read");
  assert.equal(tier("kb", "search", "dotnet", "generics"), "read");
  assert.equal(tier("notebook", "show", "sqlserver-learning"), "read");
  assert.equal(tier("module", "list"), "read");
  assert.equal(tier("plugin", "state"), "read");
  assert.equal(tier("config", "show"), "read");
  assert.equal(tier("kb", "list-sources", "dotnet"), "read");
  assert.equal(tier("doctor"), "read");
  assert.equal(tier("run", "deep_solve", "explain x", "--format", "json"), "read");
});

test("the verb is taken from the command path, not from positional values", () => {
  // "delete" here is a search query, not a subcommand
  assert.equal(tier("kb", "search", "dotnet", "delete"), "read");
});

test("writes and unknown verbs need confirmation", () => {
  assert.equal(tier("kb", "create", "new-kb"), "confirm");
  assert.equal(tier("kb", "add", "dotnet", "file.md"), "confirm");
  assert.equal(tier("notebook", "add-md", "id", "f.md"), "confirm");
  assert.equal(tier("module", "enable", "renderer-manim"), "confirm");
  assert.equal(tier("kb", "eval", "dotnet"), "confirm");
  assert.equal(tier("some-future-command", "do-thing"), "confirm");
  assert.equal(tier("workspace"), "confirm");
});

test("destructive verbs are blocked", () => {
  assert.equal(tier("kb", "delete", "dotnet"), "blocked");
  assert.equal(tier("notebook", "remove-record", "nb", "rec"), "blocked");
  assert.equal(tier("kb", "remove-web-source", "dotnet", "url"), "blocked");
  assert.equal(tier("memory", "clear"), "blocked");
  assert.equal(tier("module", "uninstall", "books"), "blocked");
  assert.equal(tier("plugin", "rollback", "x"), "blocked");
  assert.equal(tier("provider", "login", "openai"), "blocked");
});

test("interactive and long-running commands are blocked", () => {
  for (const cmd of ["chat", "start", "stop", "serve", "init"]) assert.equal(tier(cmd), "blocked", cmd);
});

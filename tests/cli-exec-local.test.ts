import { test } from "node:test";
import assert from "node:assert/strict";

// src/config.ts snapshots the deployment mode when it is first imported, so pin local
// mode before loading the module under test: no SSH host, and the fake "deeptutor" is
// this node binary (its `-e` flags play the role of deeptutor subcommand args).
process.env.DEEPTUTOR_SSH_HOST = "";
process.env.DEEPTUTOR_LOCAL_BIN = process.execPath;
const { runCli } = await import("../src/cli-exec.ts");

/** Node source for a fake CLI: write the given streams, then exit with `code`. */
const fakeCli = (stdout: string, stderr: string, code: number) =>
  [
    `require("node:fs").writeSync(1, ${JSON.stringify(stdout)});`,
    `require("node:fs").writeSync(2, ${JSON.stringify(stderr)});`,
    `process.exit(${code});`,
  ].join(" ");

test("runCli local mode keeps the child's real stderr and exit code", async () => {
  // Issue #20: the local branch split stdout on __DT_STDERR__ and shadowed res.stderr,
  // so a Python traceback became "CLI exit=2: (no stderr)".
  const traceback = "Traceback (most recent call last):\nKeyError: boom\n";
  const res = await runCli(["-e", fakeCli('{"type":"result"}\n', traceback, 2)]);
  assert.equal(res.code, 2);
  assert.equal(res.stderr, traceback.trim());
  assert.match(res.stderr, /KeyError: boom/);
  assert.equal(res.stdout, '{"type":"result"}\n');
});

test("runCli local mode reports stderr even when the CLI exits 0", async () => {
  const res = await runCli(["-e", fakeCli("", " warning: module skipped \n", 0)]);
  assert.equal(res.code, 0);
  assert.equal(res.stderr, "warning: module skipped");
});

test("runCli local mode still strips a legacy __DT_STDERR__ tail from stdout", async () => {
  const res = await runCli(["-e", fakeCli('{"ok":true}\n__DT_STDERR__wrapped boom\n', "", 2)]);
  assert.equal(res.stdout, '{"ok":true}\n');
  assert.equal(res.stderr, "wrapped boom");
});

test("runCli local mode does not lose stdout past Node's 1 MB default", async () => {
  // The deep_question repro: one JSONL event per chunk, ~1.11 MB of stdout. Without
  // maxBuffer the child was killed and the caller only saw "(no stderr)".
  const bytes = 2 * 1024 * 1024;
  const res = await runCli(["-e", `process.stdout.write("x".repeat(${bytes}))`]);
  assert.equal(res.code, 0);
  assert.equal(res.stdout.length, bytes);
  assert.equal(res.stderr, "");
});

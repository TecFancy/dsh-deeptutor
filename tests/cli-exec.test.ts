import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeCliFailure,
  execFileResolved,
  MAX_CLI_OUTPUT_BYTES,
} from "../src/cli-exec.ts";

test("execFileResolved keeps stdout larger than Node's 1 MB default", async () => {
  // `deeptutor run --format json` streams ~1.5 KB of JSON per answer character,
  // so a single 1500-character turn already crosses execFile's 1 MB default and
  // used to be killed mid-run with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
  const bytes = 2 * 1024 * 1024;
  const res = await execFileResolved(process.execPath, [
    "-e",
    `process.stdout.write("x".repeat(${bytes}))`,
  ]);
  assert.equal(res.code, 0);
  assert.equal(res.stdout.length, bytes);
});

test("execFileResolved maps a missing binary to exit 127 and keeps the code", async () => {
  const res = await execFileResolved("dsh-deeptutor-no-such-binary-xyz", []);
  assert.equal(res.code, 127);
  assert.equal(res.error, "ENOENT");
});

test("describeCliFailure prefers stderr, then the Node error code", () => {
  assert.equal(describeCliFailure({ stderr: " boom \n", error: "ENOENT" }), "boom");
  assert.equal(
    describeCliFailure({ stderr: "", error: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    `output exceeded ${MAX_CLI_OUTPUT_BYTES} bytes (see MAX_CLI_OUTPUT_BYTES)`,
  );
  assert.equal(describeCliFailure({ stderr: "", error: "ENOENT" }), "ENOENT");
  assert.equal(describeCliFailure({ stderr: "", error: undefined }), "(no stderr)");
});

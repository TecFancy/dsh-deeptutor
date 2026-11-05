import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCmdInvocation,
  escapeCmdArgument,
  findOnPath,
  parseCmdWrapper,
  resolveLocalCommand,
} from "../src/win-cmd.ts";

test("resolveLocalCommand leaves non-Windows platforms untouched", () => {
  assert.deepEqual(resolveLocalCommand("/usr/bin/deeptutor.cmd", ["kb"], "linux"), {
    file: "/usr/bin/deeptutor.cmd",
    args: ["kb"],
  });
});

test("escapeCmdArgument quotes, escapes quotes and caret-escapes metacharacters", () => {
  assert.equal(escapeCmdArgument("plain", false), '^"plain^"');
  assert.equal(escapeCmdArgument('say "hi"', false), '^"say^ \\^"hi\\^"^"');
  assert.equal(escapeCmdArgument("a&b", true), '^^^"a^^^&b^^^"');
  // trailing backslashes are doubled so they do not escape the closing quote
  assert.equal(escapeCmdArgument("dir\\", false), '^"dir\\\\^"');
});

test("buildCmdInvocation runs the batch file through cmd.exe /d /s /c verbatim", () => {
  const inv = buildCmdInvocation("C:\\bin\\deeptutor.cmd", ["kb", "list"], "C:\\Windows\\system32\\cmd.exe");
  assert.equal(inv.file, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(inv.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.ok(inv.args[3].startsWith('"C:\\bin\\deeptutor.cmd '));
  assert.equal(inv.windowsVerbatimArguments, true);
});

test("parseCmdWrapper finds the exe a forwarding wrapper calls", () => {
  const w = "C:\\Users\\me\\bin\\deeptutor.cmd";
  assert.equal(
    parseCmdWrapper('@echo off\r\n"C:\\venv\\Scripts\\deeptutor.exe" %*\r\n', w),
    "C:\\venv\\Scripts\\deeptutor.exe",
  );
  assert.equal(
    parseCmdWrapper("@C:\\venv\\Scripts\\deeptutor.exe %*", w),
    "C:\\venv\\Scripts\\deeptutor.exe",
  );
  assert.equal(
    parseCmdWrapper(':: wrapper\n@"%~dp0..\\venv\\deeptutor.exe" %*', w),
    "C:\\Users\\me\\venv\\deeptutor.exe",
  );
});

test("parseCmdWrapper refuses wrappers that do more than forward %*", () => {
  const w = "C:\\bin\\deeptutor.cmd";
  assert.equal(parseCmdWrapper('"C:\\py\\python.exe" -m deeptutor %*', w), undefined);
  assert.equal(parseCmdWrapper('set X=1\n"C:\\a\\deeptutor.exe" %*', w), undefined);
  assert.equal(parseCmdWrapper('"%VENV%\\deeptutor.exe" %*', w), undefined);
});

test("findOnPath follows PATH order and PATHEXT order", () => {
  const present = new Set([join("C:\\b", "deeptutor.cmd"), join("C:\\c", "deeptutor.exe")]);
  const env = { PATH: ["C:\\a", "C:\\b", "C:\\c"].join(process.platform === "win32" ? ";" : ":"), PATHEXT: ".EXE;.CMD" };
  assert.equal(findOnPath("deeptutor", env, (p) => present.has(p)), join("C:\\b", "deeptutor.cmd"));
  assert.equal(findOnPath("missing", env, (p) => present.has(p)), undefined);
});

// ---------- real round trips (Windows only) ----------

const TRICKY = [
  "plain",
  "two words",
  'with "quotes"',
  "a&b|c<d>e",
  "100% done",
  "%PATH%",
  "caret^ and bang!",
  "(parens), semi; comma",
  "trailing\\",
  "中文 提示",
  "",
];

function runResolved(file: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const cmd = resolveLocalCommand(file, args);
  assert.equal(cmd.error, undefined);
  return new Promise((res) => {
    execFile(
      cmd.file,
      cmd.args,
      { windowsHide: true, windowsVerbatimArguments: cmd.windowsVerbatimArguments },
      (e: any, out, err) => res({ code: e ? (e.code ?? 1) : 0, out, err }),
    );
  });
}

test(
  "a .cmd wrapper that cmd.exe must run receives every argument intact",
  { skip: process.platform !== "win32" && "Windows only" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-cmd-"));
    try {
      const echo = join(dir, "echo.js");
      writeFileSync(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
      const wrapper = join(dir, "dt wrapper.cmd");
      // extra fixed argument, so parseCmdWrapper declines and cmd.exe runs it
      writeFileSync(wrapper, `@"${process.execPath}" "${echo}" %*\r\n`);
      const r = await runResolved(wrapper, TRICKY);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(JSON.parse(r.out), TRICKY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a forwarding .cmd wrapper is bypassed and its exe gets the arguments directly",
  { skip: process.platform !== "win32" && "Windows only" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-cmd-"));
    try {
      const echo = join(dir, "echo.js");
      writeFileSync(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
      const wrapper = join(dir, "deeptutor.cmd");
      writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" %*\r\n`);
      const cmd = resolveLocalCommand(wrapper, [echo]);
      assert.equal(cmd.file, process.execPath);
      const multiLine = ["line one\nline two", ...TRICKY];
      const r = await runResolved(wrapper, [echo, ...multiLine]);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(JSON.parse(r.out), multiLine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "multi-line arguments through cmd.exe are refused with a pointer to deeptutor.exe",
  { skip: process.platform !== "win32" && "Windows only" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-cmd-"));
    try {
      const wrapper = join(dir, "dt.cmd");
      writeFileSync(wrapper, "@echo off\r\npython -m deeptutor %*\r\n");
      const cmd = resolveLocalCommand(wrapper, ["run", "chat", "a\nb"]);
      assert.match(cmd.error ?? "", /deeptutor\.exe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

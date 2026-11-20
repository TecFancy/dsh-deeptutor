import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import deeptutorExtension, { LAUNCHER, MCP_SERVER_NAME, MCP_TIMEOUT_SECONDS } from "../pi/deeptutor.ts";

/**
 * Guards the pi entry point.
 *
 * The extension is the only pi-specific code in the package, and pi loads the
 * other two hosts' resources (skills from .agents/skills) through the `pi`
 * manifest in package.json. Both are easy to break silently: a manifest that
 * stops listing the extension makes `pi install` install nothing, and a
 * registration whose launcher path moved makes every tool call fail at connect
 * time, long after CI would have run.
 *
 * No pi host is installed here on purpose: the extension takes its API by
 * structural typing (see the note in pi/deeptutor.ts), so a fake that records
 * the call is the whole contract to check.
 */
const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const pkg = read("package.json");

/** Minimal stand-in for pi's ExtensionAPI: records what the extension registers. */
function fakePi() {
  const servers: Array<{ name: string; config: Record<string, any> }> = [];
  return {
    servers,
    api: {
      registerMcpServer(name: string, config: Record<string, any>) {
        servers.push({ name, config });
      },
    },
  };
}

test("the pi manifest points at the skills and the extension", () => {
  assert.ok(pkg.pi, 'package.json needs a "pi" manifest: pi otherwise only looks for skills/, extensions/, … and skips our dot-prefixed .agents/skills');
  assert.deepEqual(pkg.pi.skills, ["./.agents/skills"], "pi must be pointed at the dot-prefixed skills directory explicitly");
  assert.deepEqual(pkg.pi.extensions, ["./pi/deeptutor.ts"], "the extension is what registers the MCP server for pi");
});

test("every path the pi manifest names exists and ships in the tarball", () => {
  for (const skill of ["deeptutor", "html-doc"]) {
    const path = `.agents/skills/${skill}/SKILL.md`;
    assert.ok(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), path);
  }
  assert.ok(existsSync(fileURLToPath(new URL("../pi/deeptutor.ts", import.meta.url))));
  // npm publishes only what `files` lists; a missing entry installs an extension-free package.
  assert.ok(pkg.files.includes("pi"), '"pi" must be in files[] or the extension never reaches npm');
  assert.ok(pkg.files.includes(".agents/skills"), '".agents/skills" must be in files[] or pi installs the extension without skills');
  assert.ok(pkg.keywords.includes("pi-package"), 'the "pi-package" keyword is what lists the package in the pi gallery');
});

test("the extension registers one stdio MCP server that starts the launcher", () => {
  const { servers, api } = fakePi();
  deeptutorExtension(api);

  assert.equal(servers.length, 1, "one registration: a second would need a distinct name or pi throws");
  const [server] = servers;
  assert.ok(server);
  assert.equal(server.name, MCP_SERVER_NAME);
  assert.equal(server.config.command, process.execPath, "the launcher must run under pi's own Node, not whatever node is on PATH");
  assert.deepEqual(server.config.args, [fileURLToPath(LAUNCHER)]);
  assert.ok(existsSync(fileURLToPath(LAUNCHER)), "the registered launcher path must exist");
  assert.ok(server.config.description?.includes("DeepTutor"), "the description is what pi's mcp_servers section and tool search show");
});

test("the registration leaves room for a long learning turn", () => {
  const { servers, api } = fakePi();
  deeptutorExtension(api);
  const { timeout, exposure } = servers[0]!.config;

  // pi's default is 60s and this server sends no progress notifications; a deep_solve turn outlives that.
  assert.equal(typeof timeout, "number");
  assert.ok(timeout >= 600, `timeout ${timeout}s is below any real deep_solve turn; pi would kill the request mid-answer`);

  // codemode (pi's default) would force a script for every call; the tools are self-contained.
  assert.equal(exposure, "deferred");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs script without type declarations
import { pickLaunch, supportsTypeStripping } from "../scripts/mcp-launch.mjs";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const plugin = read(".claude-plugin/plugin.json");
const market = read(".claude-plugin/marketplace.json");
const mcp = read(".mcp.json");

test("Claude Code plugin version follows package.json", () => {
  assert.equal(plugin.version, pkg.version, "bump .claude-plugin/plugin.json together with package.json");
  assert.equal(plugin.name, pkg.name);
});

test("marketplace lists this repo root as the plugin", () => {
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, "./");
});

test("plugin skills path points at the bundled skills", () => {
  for (const dir of plugin.skills) {
    for (const skill of ["deeptutor", "html-doc"]) {
      assert.ok(existsSync(new URL(`../${dir}${skill}/SKILL.md`, import.meta.url)), `${dir}${skill}/SKILL.md`);
    }
  }
});

test(".mcp.json starts the launcher, and the launcher and bin targets exist", () => {
  const server = mcp.mcpServers.deeptutor;
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-launch.mjs"]);
  assert.ok(existsSync(fileURLToPath(new URL("../scripts/mcp-launch.mjs", import.meta.url))));
  assert.equal(pkg.bin["dsh-deeptutor-mcp"], "lib/mcp-main.js");
  assert.ok(existsSync(fileURLToPath(new URL("../src/mcp-main.ts", import.meta.url))));
});

test("launcher prefers lib, then sources with type stripping, then npx pinned to this version", () => {
  assert.equal(supportsTypeStripping("22.5.1"), false);
  assert.equal(supportsTypeStripping("22.6.0"), true);
  assert.equal(supportsTypeStripping("24.0.0"), true);

  const lib = pickLaunch({ hasLib: true, hasSrc: true, nodeVersion: "20.11.0", version: "1.2.3" });
  assert.match(lib.args[0], /lib[\\/]mcp-main\.js$/);

  const src = pickLaunch({ hasLib: false, hasSrc: true, nodeVersion: "22.6.0", version: "1.2.3" });
  assert.deepEqual(src.args.slice(0, 2), ["--experimental-strip-types", "--no-warnings"]);
  assert.match(src.args[2], /src[\\/]mcp-main\.ts$/);

  const npx = pickLaunch({ hasLib: false, hasSrc: true, nodeVersion: "20.11.0", version: "1.2.3", platform: "win32" });
  assert.equal(npx.command, "npx");
  assert.deepEqual(npx.args, ["-y", "-p", "dsh-deeptutor@1.2.3", "dsh-deeptutor-mcp"]);
  assert.equal(npx.shell, true);
});

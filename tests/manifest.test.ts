import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { satisfies } from "semver";

/**
 * Manifest guard for issue #5 and the follow-up investigation.
 *
 * Two facts drive these assertions:
 *
 * 1. The host's install check (`evaluatePluginCompatibility` in dsh-app-boot)
 *    compares `engines.dsh`, or else every `@deepseek-ai/dsh-*` peer range,
 *    against the RUNNING host version, with includePrerelease semantics. A
 *    ceiling in that range turns every new dsh release into a refused install,
 *    which is exactly what dsh-deeptutor@0.1.9 did to 0.2.1-rc.2.
 *    The ranges here therefore declare a FLOOR only.
 *
 * 2. The host's module router lends its own copy of a `@deepseek-ai/*` package
 *    to a plugin only when that package name appears in the plugin's
 *    `peerDependencies` (dsh-app-boot `readPeerNames` + the interception route).
 *    Dropping the name makes the plugin fail to load with ERR_MODULE_NOT_FOUND
 *    while the version check still passes — keep the name, loosen only the range.
 */
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version?: string;
  engines?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const engineRange = manifest.engines?.dsh;
const peerRange = manifest.peerDependencies?.["@deepseek-ai/dsh-tools"];
/** The dsh-tools release the plugin is compiled against. */
const cohort = manifest.devDependencies?.["@deepseek-ai/dsh-tools"]?.replace(/^[~^]/, "");

/** Versions that must stay installable: the floor, today's cohort, and future lines. */
const INSTALLABLE = [
  "0.1.0-rc.6",
  ...(cohort ? [cohort] : []),
  "0.2.1-rc.2", // the version from issue #5
  "0.2.1-rc.3",
  "0.3.0-rc.1", // a future line must not be refused by a stale ceiling
  "1.0.0",
  "2.5.0-rc.1",
];

test("engines.dsh declares a floor, not a ceiling", () => {
  assert.equal(typeof engineRange, "string", "engines.dsh must be declared so the host check has one authoritative range");
  assert.match(String(engineRange).trim(), /^>=/, `engines.dsh ${JSON.stringify(engineRange)} must not cap the host line; a ceiling refuses new dsh releases`);
});

test("every host version including future lines satisfies engines.dsh", () => {
  for (const version of INSTALLABLE) {
    assert.ok(
      satisfies(version, String(engineRange), { includePrerelease: true }),
      `engines.dsh ${JSON.stringify(engineRange)} rejects ${version} — the dsh app would refuse to install this release on that host`,
    );
  }
});

test("@deepseek-ai/dsh-tools stays declared as a peer by name", () => {
  // Not a version gate: the host resolves its own copy through this name.
  assert.ok(manifest.peerDependencies !== undefined, "peerDependencies must exist");
  assert.ok(
    Object.hasOwn(manifest.peerDependencies, "@deepseek-ai/dsh-tools"),
    'dropping the "@deepseek-ai/dsh-tools" peer name makes the host skip its module routing and the plugin fails to load with ERR_MODULE_NOT_FOUND',
  );
});

test("the dsh-tools peer range is floor-only too", () => {
  assert.equal(typeof peerRange, "string");
  assert.match(String(peerRange).trim(), /^>=/, `peerDependencies["@deepseek-ai/dsh-tools"] ${JSON.stringify(peerRange)} must not cap the host line`);
  for (const version of INSTALLABLE) {
    assert.ok(
      satisfies(version, String(peerRange), { includePrerelease: true }),
      `peerDependencies["@deepseek-ai/dsh-tools"] ${JSON.stringify(peerRange)} rejects ${version} under the host's prerelease-aware check`,
    );
  }
});

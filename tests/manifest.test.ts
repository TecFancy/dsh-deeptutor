import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { satisfies } from "semver";

/**
 * Manifest guard for the failure reported in issue #5: dsh-deeptutor@0.1.9
 * shipped only `peerDependencies["@deepseek-ai/dsh-tools"] = "^0.1.0-rc.6"`,
 * so dsh 0.2.1-rc.2 refused the install ("incompatible ... requires
 * @deepseek-ai/dsh-tools ^0.1.0-rc.6"). The host's compatibility check
 * (dsh-app-boot `evaluatePluginCompatibility`) lets `engines.dsh` decide alone
 * and compares it against the RUNNING HOST version with includePrerelease
 * semantics; the peer range still drives pnpm/npm resolution under strict
 * SemVer. Keep both aligned with the cohort the plugin is built against.
 */
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version?: string;
  engines?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const peerRange = manifest.peerDependencies?.["@deepseek-ai/dsh-tools"];
const engineRange = manifest.engines?.dsh;
/** The dsh-tools release the plugin is compiled against. */
const cohort = manifest.devDependencies?.["@deepseek-ai/dsh-tools"]?.replace(/^[~^]/, "");

test("the manifest declares the supported dsh host line in engines.dsh", () => {
  assert.equal(typeof engineRange, "string", "engines.dsh must be declared so the host check has one authoritative range");
  assert.notEqual(engineRange?.trim(), "", "engines.dsh must not be empty");
});

test("engines.dsh accepts the dsh cohort the plugin is built against", () => {
  assert.equal(typeof cohort, "string");
  assert.ok(
    satisfies(String(cohort), String(engineRange), { includePrerelease: true }),
    `engines.dsh ${JSON.stringify(engineRange)} rejects ${cohort}, the dsh-tools version in devDependencies — the dsh app would refuse to install this release`,
  );
});

test("the dsh-tools peer range also accepts the dev cohort under strict SemVer", () => {
  assert.equal(typeof cohort, "string");
  assert.equal(typeof peerRange, "string", "@deepseek-ai/dsh-tools must stay a peer of the host-provided package");
  assert.ok(
    satisfies(String(cohort), String(peerRange)),
    `peerDependencies["@deepseek-ai/dsh-tools"] ${JSON.stringify(peerRange)} rejects ${cohort} under strict SemVer — pnpm/npm resolution would drift from the host cohort`,
  );
});

test("the dsh-tools peer range covers the 0.2.1 prerelease line", () => {
  // The exact host version from issue #5; a regression here means the macOS
  // app install fails again for 0.2.x users.
  assert.equal(typeof peerRange, "string");
  assert.ok(satisfies("0.2.1-rc.2", String(peerRange)), `peerDependencies["@deepseek-ai/dsh-tools"] ${JSON.stringify(peerRange)} rejects dsh 0.2.1-rc.2`);
  assert.ok(satisfies("0.2.1-rc.3", String(peerRange)), `peerDependencies["@deepseek-ai/dsh-tools"] ${JSON.stringify(peerRange)} rejects dsh 0.2.1-rc.3`);
});

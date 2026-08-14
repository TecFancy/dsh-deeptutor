#!/usr/bin/env node
/**
 * Copy the shared skill files from a pi-extensions checkout into this repo.
 * The pi repo is the single source of truth; the files must be agent-neutral.
 *
 * Usage:
 *   node scripts/sync-skills.mjs [path-to-pi-extensions]
 * Default source: ../pi-extensions
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piRoot = resolve(process.argv[2] ?? join(here, "..", "pi-extensions"));

// [pi source, this-repo destination]
// The bundle uses the root scripts/ copy at runtime (src/html-render.ts);
// the skill copy ships inside the package. Both must stay identical.
const FILES = [
  ["skills/deeptutor/SKILL.md", "skills/deeptutor/SKILL.md"],
  ["skills/deeptutor/README.md", "skills/deeptutor/README.md"],
  ["skills/html-doc/SKILL.md", "skills/html-doc/SKILL.md"],
  ["skills/html-doc/assets/template.html", "skills/html-doc/assets/template.html"],
  ["skills/html-doc/scripts/md-to-html.js", "scripts/md-to-html.js"],
  ["skills/html-doc/scripts/md-to-html.js", "skills/html-doc/scripts/md-to-html.js"],
];

let failures = 0;
for (const [src, dst] of FILES) {
  const from = join(piRoot, src);
  const to = join(here, dst);
  if (!existsSync(from)) {
    console.error(`[sync-skills] missing source: ${from}`);
    failures++;
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[sync-skills] ${src} -> ${dst}`);
}
if (failures > 0) {
  console.error("[sync-skills] some sources missing — is the pi-extensions path correct?");
  process.exit(1);
}
console.log("[sync-skills] done — review the diff, then commit.");

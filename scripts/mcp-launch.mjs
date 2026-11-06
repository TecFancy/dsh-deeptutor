#!/usr/bin/env node
/**
 * Launcher for the DeepTutor MCP server, used by the Claude Code plugin
 * (`mcpServers` in .claude-plugin/plugin.json → `node ${CLAUDE_PLUGIN_ROOT}/scripts/mcp-launch.mjs`).
 * The config lives in plugin.json, not a root .mcp.json: Claude Code also reads
 * a root .mcp.json as project-scope config whenever this repo is the working
 * directory, where ${CLAUDE_PLUGIN_ROOT} is undefined.
 *
 * A plugin installed from the marketplace is a plain git checkout: it has the
 * TypeScript sources but no compiled lib/ and no node_modules. The server has no
 * runtime dependencies, so the launcher picks the first entry that works:
 *
 *   1. lib/mcp-main.js                  compiled build (npm install, or a dev checkout after `npm run build`)
 *   2. src/mcp-main.ts                  the checkout's own sources, via Node's type stripping (Node >= 22.6)
 *   3. npx dsh-deeptutor@<this version> the published package, for older Node
 *
 * 1 and 2 run exactly the code of the installed plugin version; 3 pins the npm
 * package to the same version, so plugin and server never drift apart.
 * stdin/stdout are inherited untouched: they carry the MCP protocol.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'lib', 'mcp-main.js');
const src = join(root, 'src', 'mcp-main.ts');

/** Node >= 22.6 can run .ts with --experimental-strip-types (unflagged from 23.6). */
export function supportsTypeStripping(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 6);
}

/** Pick the command that starts the server. Exported for tests. */
export function pickLaunch({ hasLib, hasSrc, nodeVersion, version, platform = process.platform }) {
  if (hasLib) return { command: process.execPath, args: [lib] };
  if (hasSrc && supportsTypeStripping(nodeVersion)) {
    return { command: process.execPath, args: ['--experimental-strip-types', '--no-warnings', src] };
  }
  const npxArgs = ['-y', '-p', `dsh-deeptutor@${version}`, 'dsh-deeptutor-mcp'];
  // npx is a .cmd shim on Windows; spawning it needs a shell there.
  return { command: 'npx', args: npxArgs, shell: platform === 'win32' };
}

function main() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const launch = pickLaunch({
    hasLib: existsSync(lib),
    hasSrc: existsSync(src),
    nodeVersion: process.versions.node,
    version,
  });
  const child = spawn(launch.command, launch.args, {
    stdio: 'inherit',
    shell: launch.shell ?? false,
    windowsHide: true,
  });
  child.on('error', (err) => {
    process.stderr.write(`[dsh-deeptutor mcp] failed to start ${launch.command}: ${err.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

// Run only when executed directly (tests import pickLaunch). realpath + lowercase:
// Windows hands us drive letters and separators in whatever case the caller used.
const same = (a, b) => realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
if (process.argv[1] && existsSync(process.argv[1]) && same(process.argv[1], fileURLToPath(import.meta.url))) main();

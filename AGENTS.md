# Agent Instructions

Repo-specific rules for agents working on this repo (dsh-deeptutor).

## Commit conventions

- Conventional commits (`fix:` / `feat:` / `docs:` / `chore:` / `ci:` / `test:`),
  matching the existing history. Subject in English.
- Never commit unless the user asks. Never push unless the user asks.
- Stage explicit paths (`git add <path>`) rather than `git add -A`.

## Verifying a change actually works

1. `npm run typecheck` — tsc --noEmit over src/ + tests/ + scripts/*.ts.
2. `npm test` — node:test + type stripping (Node >= 22.6).
3. `npm run build` — a src/ edit without a rebuild runs stale code (dsh loads
   `lib/` from the installed package; `lib/` is gitignored, `prepack`
   rebuilds it before publish).
4. When `.claude-plugin/` changed: `claude plugin validate . --strict`.
5. When a tool's CLI usage changed, or DeepTutor was upgraded: `npm run check:cli`
   against a live deployment (from PowerShell on Windows, not Git Bash).

## Architecture rules

- Tools are defined once in `src/tools.ts`. `src/index.ts` (dsh) and
  `src/mcp.ts` (MCP / Claude Code) are thin adapters; never add tool logic to
  either host file.
- Do not mirror DeepTutor's command surface. No capability enums, no tool
  lists, no per-command wrappers for things `deeptutor_cli` already reaches.
  A dedicated tool is justified only when it does something the passthrough
  cannot (event folding, file upload, HTML rendering).
- The `deeptutor_cli` tiers live in `src/cli-policy.ts`. Unknown verbs must
  stay in the `confirm` tier; widen `read` only for verbs that cannot write.
- Keep the package free of runtime dependencies: the Claude Code plugin runs
  `src/` straight from a git checkout without `npm install`.
- MCP stdout carries protocol only: log to stderr in anything the MCP server
  imports.

## Skills

`.agents/skills/deeptutor/*` and `.agents/skills/html-doc/*` are maintained
in this repo; edit them here directly. There is no upstream copy to sync from.

- Keep `SKILL.md` in step with the tools: when a tool's parameters or
  behaviour change, update the skill in the same change.
- `scripts/md-to-html.js` and `.agents/skills/html-doc/scripts/md-to-html.js`
  must stay identical (CI checks it). Edit one, copy it over the other.

## Releases

- Version bumps are manual commits (`chore: release vX.Y.Z`) + `vX.Y.Z` tags.
  Bump `.claude-plugin/plugin.json` together with `package.json` (a test
  enforces it): the plugin's npx fallback pins the npm package to that version.
- Pushing a `v*` tag triggers `.github/workflows/release.yml` (npm publish).
  Authentication is npm Trusted Publishing (OIDC), not a token: the job holds
  `id-token: write` and no `NPM_TOKEN` secret exists. Three things must stay
  true or publishing fails with a bare `ENEEDAUTH`:
  - the trusted publisher on npmjs.com names this repository and the workflow
    filename `release.yml` — renaming the file means updating npm first;
  - the job keeps `id-token: write`;
  - `actions/setup-node` is **not** given `registry-url`. That input writes
    `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc`; with no
    token it expands to an empty string, npm reads it as "auth already
    configured", skips the OIDC exchange and fails
    ([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)).

  Node 24 is pinned because Trusted Publishing needs npm ≥ 11.5.1, and Node 22
  ships npm 10.9.x. `--provenance` is not passed: a trusted publish attests
  automatically.

## Branch model

- Daily work happens on `development`; `main` only receives PRs/merges.
  Never commit to `main` directly.

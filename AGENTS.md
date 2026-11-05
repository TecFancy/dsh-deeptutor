# Agent Instructions

Repo-specific rules for agents working on this repo (dsh-deeptutor).

## Commit conventions

- Conventional commits (`fix:` / `feat:` / `docs:` / `chore:` / `ci:` / `test:`),
  matching the existing history. Subject in English.
- Never commit unless the user asks. Never push unless the user asks.
- Stage explicit paths (`git add <path>`) rather than `git add -A`.

## Verifying a change actually works

1. `npm run typecheck` — tsc --noEmit over src/ + tests/.
2. `npm test` — node:test + type stripping (Node >= 22.6).
3. `npm run build` — a src/ edit without a rebuild runs stale code (dsh loads
   `lib/` from the installed package; `lib/` is gitignored, `prepack`
   rebuilds it before publish).

## Skills

`.agents/skills/deeptutor/*` and `.agents/skills/html-doc/*` are maintained
in this repo; edit them here directly. There is no upstream copy to sync from.

- Keep `SKILL.md` in step with the tools: when a tool's parameters or
  behaviour change, update the skill in the same change.
- `scripts/md-to-html.js` and `.agents/skills/html-doc/scripts/md-to-html.js`
  must stay identical (CI checks it). Edit one, copy it over the other.

## Releases

- Version bumps are manual commits (`chore: release vX.Y.Z`) + `vX.Y.Z` tags.
- Pushing a `v*` tag triggers `.github/workflows/release.yml` (npm publish;
  requires the `NPM_TOKEN` secret, otherwise publish locally).

## Branch model

- Daily work happens on `development`; `main` only receives PRs/merges.
  Never commit to `main` directly.

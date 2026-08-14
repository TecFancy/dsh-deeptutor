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

## Shared skills — single source of truth

`skills/deeptutor/*` and `skills/html-doc/*` are byte-identical copies of the
same files in `TecFancy/pi-extensions`. Never edit them here — edit in
pi-extensions first (keep them agent-neutral), then run:

```bash
node scripts/sync-skills.mjs ../pi-extensions
```

## Releases

- Version bumps are manual commits (`chore: release vX.Y.Z`) + `vX.Y.Z` tags.
- Pushing a `v*` tag triggers `.github/workflows/release.yml` (npm publish;
  requires the `NPM_TOKEN` secret, otherwise publish locally).

## Branch model

- Daily work happens on `development`; `main` only receives PRs/merges
  (mirrors the pi-extensions repo). Never commit to `main` directly.

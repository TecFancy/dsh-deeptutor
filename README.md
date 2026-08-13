# dsh-deeptutor

DeepTutor bridge **bundle** for **DeepSeek Harness (dsh)**, migrated from the
pi coding-agent extension (`TecFancy/pi-extensions`, `extensions/deeptutor` +
`skills/deeptutor`).

Registers three model-facing tools that drive the
[HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) tutoring service:

| Tool | Purpose |
|---|---|
| `deeptutor_run` | Run a learning capability: `deep_solve` / `deep_question` / `deep_research` / `chat` / `mastery_path` / `visualize` / `math_animator` (HTTP/WS first, CLI fallback) |
| `deeptutor_kb` | List / search / info the user's personal knowledge bases (RAG) |
| `deeptutor_note` | Archive Markdown learning notes to a server notebook |

Deployment auto-detects local vs. remote: local `serve` (or local CLI) on this
machine, or a server reached through an auto-started SSH tunnel (with SSH CLI
fallback).

## Install into a profile (bundle)

The package is published to npm as `dsh-deeptutor`. A bundle install has two
parts: (1) install the npm package into the profile, and (2) make the loader
mount it by listing it in the profile's `dsh.profile.bundles`.

```sh
# 1. install the npm package into the profile (forwards to pnpm)
dsh plugin --profile web add dsh-deeptutor
```

```json
// 2. add the bundle to the profile manifest (~/.dsh/profiles/<name>/package.json)
{
  "dependencies": { "dsh-deeptutor": "^0.1.0" },
  "dsh": {
    "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-deeptutor"] }
  }
}
```

Both steps are required. With dsh CLI 0.1.0-rc.x, `dsh plugin add` is a plain
pnpm forwarder — it installs the dependency but does **not** touch
`dsh.profile.bundles`, so skipping step 2 leaves the package installed but
never loaded. Restart dsh after installing; the bundle list is resolved at
boot.

Alternatively, keep the manifest untouched and mount the bundle through a user
patch layer (the npm package still has to be installed first):

```yaml
# overlay.yml — insert the bundle row via a user patch layer
- insert:
    - id: dsh-deeptutor
      name: 'dsh-deeptutor'
```

```sh
dsh web --patch ./overlay.yml
```

The bundle manifest (`dsh.bundle.patch → cordis.patch.yml`) inserts the plugin
row; later patch layers can override or disable it by id.

## Develop against a checkout (no publish needed)

```sh
dsh web --patch /path/to/dsh-deeptutor/cordis.yml
```

## Build & publish

```sh
npm install
npm run build        # tsc → lib/ (relative .ts imports rewritten to .js)
npm run typecheck
npm pack             # inspect dsh-deeptutor-0.1.0.tgz
npm publish          # set a scope/registry of your choice first
```

Node ≥ 22.6 (type stripping) is needed to load the raw `src/*.ts` via
`--patch`; the published bundle ships compiled `lib/`, so installed profiles
run on plain Node ≥ 20 ESM.

## Skills

The agent-facing workflow lives in the `deeptutor` skill, installed at
`~/.dsh/skills/deeptutor/SKILL.md` (auto-discovered by dsh). The companion
`html-doc` skill (`~/.dsh/skills/html-doc/`) renders study answers to
self-contained HTML pages; this plugin bundles the same converter under
`scripts/md-to-html.js` and uses it when `deeptutor_run` gets an `html` path.

## Configuration (env vars, agent-agnostic)

```bash
# Remote deployment (DeepTutor on a server, reached through an SSH tunnel)
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH host alias (set = remote mode)
export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"   # local tunnel address
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# Local deployment — leave DEEPTUTOR_SSH_HOST unset
# export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"  # local serve port
# export DEEPTUTOR_LOCAL_BIN="deeptutor"             # local CLI path (default: deeptutor on PATH)
```

Restart dsh after changing env vars.

## Layout

```
src/                 # TypeScript sources (dev loading, typecheck)
lib/                 # compiled ESM (published entry, from `npm run build`)
scripts/md-to-html.js  # zero-dependency Markdown → HTML converter
cordis.yml           # dev overlay: insert src/index.ts by absolute path
cordis.patch.yml     # bundle patch: insert the package by name
```

`src/index.ts` registers the tools; `config.ts` holds env config;
`cli-exec.ts` local/SSH CLI execution; `http-api.ts` API probing + SSH tunnel;
`turn.ts` one learning turn (WebSocket / CLI event folding + formatting);
`html-render.ts` answer → self-contained HTML.

# DeepTutor Learning Assistant (extension / bundle + SKILL)

> This README is the human-facing documentation; `SKILL.md` is the agent-facing instruction file (loaded on demand).
> The same code ships in two ecosystems — edit in `pi-extensions` first, then sync to `dsh-deeptutor` (see Maintenance).

Bridges **DeepTutor** (open-source personalized tutoring platform) into your
agent: combines your **personal knowledge bases** (RAG retrieval) with
**authoritative web sources** to generate learning content, self-test
questions, and study plans — then archives your notes to a DeepTutor notebook
for later review.

- **pi** — extension `extensions/deeptutor/` (entry: `index.ts`) + skill `skills/deeptutor/SKILL.md` (repo: `TecFancy/pi-extensions`)
- **dsh** — npm bundle `dsh-deeptutor` (the same TypeScript core) + the same skill, installed to `~/.dsh/skills/deeptutor/` (repo: `TecFancy/dsh-deeptutor`)

## Features

| Capability     | Description                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Deep Solve     | In-depth explanation of a topic grounded in knowledge bases + web search, with multi-turn follow-up (session continuity) |
| Deep Question  | Generate exercises from the same learning session                                                                        |
| Deep Research  | Long multi-stage research (report mode supported)                                                                        |
| KB Retrieval   | RAG hits from your personal knowledge bases (dotnet / sqlserver / react, …)                                              |
| Note Archiving | Save study notes/plans to a server notebook for searchable review                                                        |
| Mastery Path   | Multi-stage learning path planning                                                                                       |

## Installation

### pi

```bash
# Install the pi package (extension + SKILL)
pi install git:github.com/TecFancy/pi-extensions

# Local development: /reload after editing (local path installs are not copied)
pi install D:/source/personal/pi-extensions
```

### dsh

```bash
# One-shot: bundle + skill, from the published package
pnpm dlx dsh-deeptutor --profile web

# Or install the skill manually from a checkout
xcopy /e /i skills\deeptutor %USERPROFILE%\.dsh\skills\deeptutor   # Windows
cp -r skills/deeptutor ~/.dsh/skills/deeptutor                     # macOS/Linux
```

## Configuration (environment variables)

Set these in `~/.bashrc` or `~/.zshrc` (inherited by any agent at startup — agent-agnostic):

```bash
# —— Remote deployment (DeepTutor on a server, via SSH tunnel) ——
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH alias (set = remote mode)
export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"   # local tunnel address (change port here)
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# —— Local deployment (DeepTutor on this machine) —— leave DEEPTUTOR_SSH_HOST unset for local mode
# export DEEPTUTOR_LOCAL_BIN="deeptutor"            # local CLI path (default: deeptutor on PATH)
# export DEEPTUTOR_HOME="/path/to/local-workspace"  # local workspace
```

**Deployment auto-adapts**: API reachable (local serve or tunnel) → HTTP/WS; unreachable → local CLI or SSH CLI fallback.

## Usage

Just talk to your agent:

```
Deep-dive Span<T> with my dotnet knowledge base, quiz me with 5 questions, then archive the notes to a notebook
```

The agent follows the SKILL workflow automatically:

1. **Dual sourcing**: `web_search` for authoritative material (Microsoft Learn, etc.) + `deeptutor_kb search` on your personal KB
2. **Deep Solve**: `deeptutor_run` (deep_solve, mount KB + rag + web_search, Chinese replies)
3. **Follow-up turns**: reuse the returned `session_id` to continue context
4. **Self-test**: `deep_question` (config `num_questions`)
5. **Plan**: structured study plan combining authoritative links + KB highlights
6. **Archive**: `deeptutor_note` into a notebook

## Tools

| Tool             | Key parameters                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deeptutor_run`  | `capability` (deep_solve / deep_question / deep_research / chat / mastery_path / …), `kbs`, `tools` (rag / web_search), `session_id`, `config`, `language` |
| `deeptutor_kb`   | `list` / `search` (kb + query + mode) / `info`                                                                                                             |
| `deeptutor_note` | `notebook` (auto-created), `title`, `type` (chat/question/research/solve), `content` (Markdown)                                                            |

## Troubleshooting

| Symptom                                         | Cause & fix                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection timeout / host resolution failure    | ① Check `DEEPTUTOR_SSH_HOST` is set and SSH passwordless login works ② Is `deeptutor serve` running? (`curl http://127.0.0.1:8001/api/v1/system/status`)                           |
| Tool returns "No DEEPTUTOR_* env vars detected" | One-time hint on first call; configure per the Configuration section and restart the agent                                                                                         |
| Local CLI garbled output / crashes              | The tools inject `PYTHONUTF8=1` automatically; verify Python ≥ 3.11 otherwise                                                                                                      |
| DNS resolution fails (Windows)                  | Common on corporate networks: if `nslookup` works but curl/python can't resolve, fix `C:\Windows\System32\drivers\etc\hosts` (when appending entries, always start with a newline) |
| CLI-only package missing modules                | Official `packaging/deeptutor-cli` has incomplete deps; `pip install <module>` per the error (known: loguru, fastapi)                                                              |

## FAQ

**Q: Can local and remote be used at the same time?**
A: Yes. Switching only requires changing env vars (set/remove `DEEPTUTOR_SSH_HOST`); the SKILL and tools stay unchanged.

**Q: What if I change servers or ports?**
A: Only env vars change (`DEEPTUTOR_SSH_HOST` / `DEEPTUTOR_API_BASE` / remote paths) — never the SKILL or tools.

**Q: Is the knowledge base list hardcoded?**
A: No. Tools query `deeptutor_kb list` dynamically; new bases are picked up automatically.

**Q: Can other agents (Claude Code / Codex) use it?**
A: Yes. The SKILL follows the Agent Skills standard and can be linked into `~/.agents/skills/`; the `deeptutor_*` tools are registered by the pi extension or the dsh bundle.

## Maintenance

Shared skill files (`skills/deeptutor/*`, `skills/html-doc/*`) live **in this
repo (pi-extensions)** and are kept agent-neutral. `dsh-deeptutor` ships
byte-identical copies; after editing, sync with:

```bash
cd ../dsh-deeptutor && node scripts/sync-skills.mjs ../pi-extensions
```

- pi code: edit the relevant file under `extensions/deeptutor/` (`index.ts` for tool wiring, `cli-exec.ts`/`http-api.ts`/`turn.ts` for transport logic, `config.ts` for env vars/helpers) → `/reload` to verify
- dsh code: same files under `dsh-deeptutor/src/` → rebuild with `npm run build`
- Release pi: push a tag to GitHub, then `pi install git:github.com/TecFancy/pi-extensions@<tag>`
- Release dsh: bump the version in `package.json`, push a `v*` tag → CI publishes to npm

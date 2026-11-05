# DeepTutor Learning Assistant (dsh bundle + SKILL)

> This README is the human-facing documentation; `SKILL.md` is the agent-facing instruction file (loaded on demand).
> The bundle and this skill both live in `TecFancy/dsh-deeptutor`.

Bridges **DeepTutor** (open-source personalized tutoring platform) into your
agent: combines your **personal knowledge bases** (RAG retrieval) with
**authoritative web sources** to generate learning content, self-test
questions, and study plans — then archives your notes to a DeepTutor notebook
for later review.

Shipped as the npm bundle `dsh-deeptutor` for DeepSeek Harness (dsh); the
installer also copies this skill to `~/.dsh/skills/deeptutor/`.

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

```bash
# One-shot: bundle + skill, from the published package
pnpm dlx dsh-deeptutor --profile web

# Or install the skill manually from a checkout
xcopy /e /i .agents\skills\deeptutor %USERPROFILE%\.dsh\skills\deeptutor   # Windows
cp -r .agents/skills/deeptutor ~/.dsh/skills/deeptutor                     # macOS/Linux
```

## Configuration (environment variables)

Set these in `~/.bashrc` or `~/.zshrc` (inherited by any agent at startup — agent-agnostic):

```bash
# —— Remote deployment (DeepTutor on a server, driven over SSH) ——
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH alias (set = remote mode)
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# —— Local deployment (DeepTutor on this machine) —— leave DEEPTUTOR_SSH_HOST unset for local mode
# export DEEPTUTOR_LOCAL_BIN="deeptutor"            # local CLI path (default: deeptutor on PATH)
# export DEEPTUTOR_HOME="/path/to/local-workspace"  # local workspace
```

**How calls run**: the tools always drive the DeepTutor CLI — the local binary, or the remote one over SSH when `DEEPTUTOR_SSH_HOST` is set. `deeptutor serve` does not need to be reachable.

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
| Connection timeout / host resolution failure    | ① Check `DEEPTUTOR_SSH_HOST` is set and SSH passwordless login works ② Does the remote CLI run? (`ssh <alias> <DEEPTUTOR_REMOTE_BIN> kb list --format json`)                           |
| Tool returns "No DEEPTUTOR_* env vars detected" | One-time hint on first call; configure per the Configuration section and restart the agent                                                                                         |
| Local CLI garbled output / crashes              | The tools inject `PYTHONUTF8=1` automatically; verify Python ≥ 3.11 otherwise                                                                                                      |
| DNS resolution fails (Windows)                  | Common on corporate networks: if `nslookup` works but curl/python can't resolve, fix `C:\Windows\System32\drivers\etc\hosts` (when appending entries, always start with a newline) |
| CLI-only package missing modules                | Official `packaging/deeptutor-cli` has incomplete deps; `pip install <module>` per the error (known: loguru, fastapi)                                                              |
| `No such command 'kb'` / capability unknown     | DeepTutor 1.7+ ships features as modules; check `deeptutor module list`, then `deeptutor module install <name>` (e.g. `knowledge`, `notebook`, `solve`)                           |

## FAQ

**Q: Can local and remote be used at the same time?**
A: Yes. Switching only requires changing env vars (set/remove `DEEPTUTOR_SSH_HOST`); the SKILL and tools stay unchanged.

**Q: What if I change servers?**
A: Only env vars change (`DEEPTUTOR_SSH_HOST` / remote paths) — never the SKILL or tools.

**Q: Is the knowledge base list hardcoded?**
A: No. Tools query `deeptutor_kb list` dynamically; new bases are picked up automatically.

**Q: Can other agents (Claude Code / Codex) use it?**
A: Yes. The SKILL follows the Agent Skills standard and can be linked into `~/.agents/skills/`; the `deeptutor_*` tools are registered by the dsh bundle; other agents use the plain CLI path described in the SKILL.

## Maintenance

The bundle code (`src/`) and this skill live in `TecFancy/dsh-deeptutor`; edit both there.

- Code: `src/index.ts` for tool wiring, `cli-exec.ts` / `turn.ts` for CLI execution, `config.ts` for env vars/helpers → `npm run typecheck && npm test && npm run build`
- Skill: edit `.agents/skills/deeptutor/` directly and keep it in step with the tool parameters
- Release: bump the version in `package.json`, push a `v*` tag → CI publishes to npm

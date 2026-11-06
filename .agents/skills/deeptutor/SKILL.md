---
name: deeptutor
description: Combine DeepTutor personal knowledge bases (RAG) with authoritative web sources to generate learning content, self-test questions, and study plans, and archive notes to a notebook. Works with both local and remote DeepTutor deployments. Use when the user wants to learn/review a technical topic (e.g. .NET, C#, SQL Server, React), get a deep explanation grounded in their own knowledge bases, generate exercises, plan their learning, or manage their DeepTutor knowledge bases and notebooks.
---

# DeepTutor Learning Assistant (Personal Knowledge Base)

Combines the user's **personal knowledge bases** (RAG retrieval) with
**authoritative web sources** to produce learning content, self-test
questions, and study plans, then archives notes to a DeepTutor notebook.

## Drivers

This skill is **agent-agnostic**. Use the first driver that exists in your
environment; the action, not the tool, is what matters.

1. **The `deeptutor_*` tools** (preferred). dsh registers them through the
   `dsh-deeptutor` bundle; Claude Code and other MCP clients get the same four
   tools from the `dsh-deeptutor` plugin's MCP server (in Claude Code they are
   named `mcp__plugin_dsh-deeptutor_deeptutor__deeptutor_run` and so on).
2. **The plain CLI.** `deeptutor <args>` locally, or
   `ssh <DEEPTUTOR_SSH_HOST> <DEEPTUTOR_REMOTE_BIN> <args>` for a remote
   deployment. On Windows run it from PowerShell, not Git Bash: MSYS rewrites
   `/home/...` env values into Windows paths.

| Tool             | Use it for                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| `deeptutor_run`  | one learning turn: explanation, questions, research, mastery path, …        |
| `deeptutor_kb`   | list / search / info of knowledge bases                                     |
| `deeptutor_note` | archive a Markdown note into a notebook (find-or-create, file upload)       |
| `deeptutor_cli`  | **everything else** the CLI offers: `deeptutor <args>` behind safety tiers |

## Configuration (env vars, agent-agnostic)

Nothing is hardcoded in this skill; all server parameters come from environment
variables that every agent inherits at startup. **Deployment mode adapts
automatically**:

```bash
# Remote deployment (DeepTutor on a server, driven over SSH)
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH host alias (set = remote mode)
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# Local deployment: leave DEEPTUTOR_SSH_HOST unset
# export DEEPTUTOR_LOCAL_BIN="deeptutor"             # local CLI path (default: deeptutor on PATH)
```

`deeptutor serve` never needs to be reachable: every call runs the CLI.
Changing servers only changes env vars, never this skill.

## Discover, don't assume

DeepTutor's command set, capabilities and tools change between releases and
between deployments (1.7+ ships them as optional modules). This skill
deliberately lists only the core workflow. For anything else, **ask the CLI**
and use only what it shows; never invent commands or flags:

| To learn                         | Call                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| top-level commands               | `deeptutor_cli args=["--help"]`                                   |
| one command's subcommands/flags  | `deeptutor_cli args=["kb","--help"]`, `["kb","search","--help"]`  |
| capabilities ready on this host  | `deeptutor_cli args=["module","list"]` (JSON; `capabilities` of modules with `ready: true`) |
| tools a turn can enable          | `deeptutor_cli args=["plugin","list"]`, details via `["plugin","info","<name>"]` |
| knowledge bases                  | `deeptutor_kb action=list`                                        |

`deeptutor_run` also tells you the available capabilities when you pick one
that is not ready. If a needed capability or command does not exist, say so to
the user instead of guessing.

## Safety tiers (`deeptutor_cli`)

- **read**: runs directly. `--help`; verbs `list`, `show`, `info`, `search`,
  `state`, `status`, `list-*`; `doctor`; `run`.
- **confirm**: everything else, including commands you have just discovered
  (`kb create`, `kb add`, `notebook add-md`, `module enable`, …). Set
  `confirm=true` **only after the user explicitly asked for that change**;
  never proactively, never to "try it".
- **blocked**: destructive verbs (`delete`, `remove*`, `clear`, `uninstall`,
  `rollback`, `login`, …) and interactive or long-running commands (`chat`,
  `start`, `stop`, `serve`, `init`). The tool refuses them; tell the user the
  exact command to run in their own terminal.

With the plain CLI driver the same rules apply; you enforce them yourself.

## Recommended Learning Workflow

### 1. Gather material from both channels

- `web_search` for **authoritative sources**: official docs (learn.microsoft.com, …), official blogs, trusted tutorials. Keep the links.
- Search the user's personal knowledge base. List bases first, never assume names:
  `deeptutor_kb action=list`, then `deeptutor_kb action=search kb=<kb> query="<topic>"`.

### 2. Deep Solve

`deeptutor_run capability=deep_solve prompt="<topic>" kbs=[<kb>] tools=[rag, web_search] language=zh`

(CLI: `deeptutor run deep_solve "<topic>" --kb <kb> --tool rag --tool web_search --language zh --format json`)

**Record the returned `session_id`** and reuse it for every follow-up turn so
DeepTutor keeps the context (history, knowledge bases, tools).

### 3. Follow-up questions / targeted reinforcement

Continue with the same `session_id`: details, code examples, pitfalls,
differences vs. authoritative sources.

### 4. Self-test

`deeptutor_run capability=deep_question prompt="<topic essentials>" session_id=<same> config={num_questions: 5} kbs=[<kb>] language=zh`

### 5. Study plan

Combine the three sources into a structured Markdown plan: goals and
prerequisites; core concepts (marked personal KB / authoritative link); phased
schedule (concept → authoritative reading → KB review → exercises); quiz and
acceptance criteria; references.

### 5b. Render study material to local HTML (recommended)

Pass `html` to `deeptutor_run` and the answer is rendered to a self-contained
page (dark/light toggle, TOC, collapsible quiz answers, print-friendly) with
the bundled **html-doc** converter, plus the `.md` source next to it:

```
deeptutor_run capability=deep_solve prompt=<topic> kbs=[...] tools=[rag, web_search]
  html="data/study/<topic>/knowledge.html" html_title="<主题> · 知识点" language=zh
```

Relative paths resolve against your working directory. To render other
Markdown, use the html-doc skill's converter
(`node <html-doc skill dir>/scripts/md-to-html.js <in.md> --out <out.html> --title "<t>" --toc`).
Tell the user the file paths.

### 6. Archive (only on request)

`deeptutor_note notebook=<name> title="<t>" type=solve content=<markdown>`
(creates the notebook if missing).

## Notes

- Calls return when the turn finishes; there is no live progress stream.
- `deep_research` can take minutes: pass `timeout` 900+ or split the task.
- Results are truncated at `max_chars` (default 30000); ask to continue for more.
- `deeptutor_run` covers the common flags; CLI-only flags such as
  `--notebook-ref` / `--history-ref` go through `deeptutor_cli args=["run", …]`.
- RAG hits can be noisy; treat official sources as authoritative and point out
  conflicts to the user.

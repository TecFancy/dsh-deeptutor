---
name: deeptutor
description: Combine DeepTutor personal knowledge bases (RAG) with authoritative web sources to generate learning content, self-test questions, and study plans, and archive notes to a notebook. Works with both local and remote DeepTutor deployments. Use when the user wants to learn/review a technical topic (e.g. .NET, C#, SQL Server, React), get a deep explanation grounded in their own knowledge bases, generate exercises, or plan their learning.
---

# DeepTutor Learning Assistant (Personal Knowledge Base)

Combines the user's **personal knowledge bases** (RAG retrieval) with
**authoritative web sources** to produce learning content, self-test
questions, and study plans, then archives notes to a DeepTutor notebook.

This skill is **agent-agnostic**: every action below has two equivalent
drivers —

- **dsh (with the dsh-deeptutor bundle installed):** the `deeptutor_*` tools.
  They auto-adapt local/remote deployment (HTTP/WS first with an automatic
  SSH tunnel, CLI fallback) and stream progress.
- **Any agent / plain CLI:** the `deeptutor` executable directly (local
  binary on PATH, or over SSH for remote deployments). No extension needed.

Pick whichever path exists in your environment; the action, not the tool, is
what matters.

## When to Use

- The user wants to learn or review a technical topic (.NET, C#, SQL Server, React, …)
- The user wants content grounded in their own notes/knowledge bases
- The user wants generated exercises, quizzes, or a learning plan
- The user wants to archive study notes for later review

## Configuration (env vars, agent-agnostic)

Nothing is hardcoded in this skill; all server parameters come from environment variables (put them in `~/.bashrc` or `~/.zshrc`; any agent — dsh / Claude Code / Codex / opencode — inherits them at startup). **Deployment mode adapts automatically**:

```bash
# Remote deployment (DeepTutor on a server, reached through an SSH tunnel)
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH host alias (set = remote mode)
export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"   # local tunnel address (change port/server here)
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# Local deployment (DeepTutor on this machine) — leave DEEPTUTOR_SSH_HOST unset for local mode
# export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"  # local serve port
# export DEEPTUTOR_LOCAL_BIN="deeptutor"             # local CLI path (default: deeptutor on PATH)
```

- **dsh path:** API reachable (local serve or tunnel) → HTTP/WS; unreachable →
  local CLI or SSH CLI fallback automatically. The bundle starts/recycles
  the SSH tunnel; local mode needs no tunnel.
- **Plain CLI path:** run `deeptutor <subcommand>` locally, or
  `ssh <DEEPTUTOR_SSH_HOST> <DEEPTUTOR_REMOTE_BIN> <subcommand>` for remote
  deployments (the tunnel is the extension's job — CLI users don't need it).
- Migrating to another server or port only requires changing env vars — never this skill.

## Actions Cheat Sheet

| Action                       | dsh (tools)                      | CLI equivalent (`deeptutor …`)                               |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------ |
| List knowledge bases         | `deeptutor_kb action=list`       | `kb list --format json`                                      |
| Search a knowledge base      | `deeptutor_kb action=search`     | `kb search <kb> "<query>" --format json --mode hybrid`       |
| Show a knowledge base's info | `deeptutor_kb action=info`       | `kb info <kb>`                                               |
| Run a learning capability    | `deeptutor_run capability=<cap>` | `run <cap> "<prompt>" --format json`                         |
| Archive a note to a notebook | `deeptutor_note`                 | `notebook add-md <nb-id> <file> --title "<t>" --type <type>` |
| View lightweight memory      | — (CLI only)                     | `memory show`                                                |
| List / inspect sessions      | — (CLI only)                     | `session list` · `session show <id>`                         |
| Show a notebook's records    | — (CLI only)                     | `notebook show <name>`                                       |
| Inspect configuration        | — (CLI only)                     | `config show` (troubleshooting)                              |

Capabilities: `deep_solve` / `deep_question` / `deep_research` / `chat` /
`mastery_path` / `visualize` / `math_animator`.

Useful `run` flags: `--kb <name>` (mount a knowledge base, repeatable),
`--tool <name>` (`rag`, `web_search`, `reason`, …, repeatable),
`--session <id>` (continue context), `--language zh`, `--config k=v`
(repeatable; e.g. `--config num_questions=5`), `--config-json '{"..."}'`
(complex config), `--notebook-ref <name>` / `--history-ref <id>` (reference
notebooks or past sessions from the prompt).

## Discovering Commands

The command set evolves — this cheat sheet is a curated subset, not the full
surface. Before using a command not listed here, **discover it from the CLI
itself** and never invent flags:

```bash
deeptutor --help              # top-level commands
deeptutor <cmd> --help        # one subcommand's options
```

Read the output, then use only what it shows. If a needed capability is not
in `--help`, report that to the user instead of guessing.

## Recommended Learning Workflow

### 1. Gather material from both channels

- `web_search` for **authoritative sources**: official docs (Microsoft Learn / learn.microsoft.com), official blogs, trusted tutorials. Keep the source links.
- Search the user's personal knowledge base (pick the right one: dotnet-related → their dotnet base, database → sqlserver) to get their own curated notes:
  - pi: `deeptutor_kb action=search kb=<kb> query="<topic>"`
  - CLI: `deeptutor kb search <kb> "<topic>" --format json`
  - Always list bases first (`deeptutor_kb action=list` / `deeptutor kb list --format json`) — never assume names.

### 2. Deep Solve

- pi: `deeptutor_run capability=deep_solve prompt="<topic>" kbs=[<kb>] tools=[rag, web_search] language=zh`
- CLI: `deeptutor run deep_solve "<topic>" --kb <kb> --tool rag --tool web_search --language zh --format json`

**Always record the returned `session_id`** — reuse it for every follow-up turn so DeepTutor keeps the context (chat history, knowledge bases, tools).

### 3. Follow-up questions / targeted reinforcement

Continue with the same `session_id`: details, code examples, common pitfalls, differences vs. authoritative sources.

### 4. Self-test

- pi: `deeptutor_run capability=deep_question prompt="<topic essentials>" session_id=<same> config={num_questions: 5} kbs=[<kb>] language=zh`
- CLI: `deeptutor run deep_question "<topic essentials>" --session <same> --config num_questions=5 --kb <kb> --language zh --format json`

### 5. Output a study plan

Combine all three material sources into a structured plan (Markdown):

- Learning goals and prerequisites
- Core concept list (marked: from personal KB / authoritative link)
- Phased schedule (each phase: concept → authoritative reading → KB review → exercises)
- Quiz questions and acceptance criteria
- Reference list (authoritative links + KB hit sources)

### 5b. Render study material to local HTML (recommended)

When the user wants readable/browsable/printable study material, render the
answers to a self-contained HTML page (dark/light toggle, TOC, collapsible
quiz answers, print-friendly) with the **html-doc skill** (zero-dependency
Node converter):

```bash
node skills/html-doc/scripts/md-to-html.js <answer.md> --out <page.html> --title "<主题>" --toc
```

On dsh, `deeptutor_run` does this automatically when given the `html` param:

```
deeptutor_run capability=deep_solve  prompt=<topic>  kbs=[...]  tools=[rag, web_search]
  html="data/study/<topic>/knowledge.html"  html_title="<主题> · 知识点"  language=zh
deeptutor_run capability=deep_question  prompt=<topic essentials>  config={num_questions: 5}
  html="data/study/<topic>/quiz.html"  html_title="<主题> · 自测题"  language=zh
```

Then tell the user the HTML file paths so they can open them in a browser.

### 6. Archive

Store the final notes/plan in a server notebook (e.g. `dotnet-learning`) so they can be retrieved for review later:

- dsh: `deeptutor_note notebook=<name> title="<t>" type=solve content=<markdown>`
- CLI:
  ```bash
  deeptutor notebook list                       # find the notebook id
  deeptutor notebook create <name> --description "archived"   # only if missing
  deeptutor notebook add-md <nb-id> <notes.md> --title "<t>" --type solve
  ```

## Safety Boundaries

Read-only exploration is always fine: `kb list/info/search`, `memory show`,
`session list/show`, `config show`, `notebook list/show`.

Never run destructive commands: `kb delete`, `memory clear`, `session delete`,
`notebook remove-record`. Creation/update commands (`kb create/add`,
`notebook create/add-md/replace-md`, `session rename`) only on the user's
explicit request — never proactively.

## Notes

- On dsh, calls go through HTTP/WS first (tunnel), falling back to SSH CLI automatically when the tunnel is down; `deeptutor_run` streams over WebSocket so progress is visible.
- `deep_research` can take minutes: give a generous timeout (900+) or split long tasks.
- Results may be truncated (default 30000 chars) — ask to continue for the full content.
- RAG hits can be noisy; treat official sources as authoritative and point out conflicts to the user.
- Do not delete knowledge bases or run destructive operations (see Safety
  Boundaries above); `kb create/add` is fine, but only on the user's explicit
  request, never proactively.
- CLI output: add `--format json` for machine-readable events; without it you get human-readable text.

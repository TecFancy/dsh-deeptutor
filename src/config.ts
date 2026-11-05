/**
 * DeepTutor bridge: shared configuration (env vars) and small helpers.
 *
 * Every call goes through the deeptutor CLI. DeepTutor 1.7 moved its HTTP/WS routes off
 * /api/v1 and put them behind a login, so the plugin no longer talks to `deeptutor serve`.
 *
 * Config (optional env vars, agent-agnostic):
 *   DEEPTUTOR_SSH_HOST    SSH host alias (remote deployment; unset/empty = local deployment)
 *   DEEPTUTOR_LOCAL_BIN   local deeptutor executable (default: deeptutor on PATH)
 *   DEEPTUTOR_REMOTE_BIN  remote deeptutor binary path (remote deployment)
 *   DEEPTUTOR_REMOTE_HOME remote DEEPTUTOR_HOME workspace (remote deployment)
 */
export const SSH_HOST = process.env.DEEPTUTOR_SSH_HOST ?? "";
export const LOCAL_BIN = process.env.DEEPTUTOR_LOCAL_BIN ?? "deeptutor";
export const DEEPTUTOR_BIN =
  process.env.DEEPTUTOR_REMOTE_BIN ?? "/home/ubuntu/my-deeptutor/.venv/bin/deeptutor";
export const DEEPTUTOR_HOME = process.env.DEEPTUTOR_REMOTE_HOME ?? "/home/ubuntu/my-deeptutor";

// Whether the user explicitly configured anything (show a one-time hint when not)
const IS_CONFIGURED = Boolean(
  process.env.DEEPTUTOR_SSH_HOST ||
    process.env.DEEPTUTOR_LOCAL_BIN ||
    process.env.DEEPTUTOR_REMOTE_BIN ||
    process.env.DEEPTUTOR_REMOTE_HOME,
);
let configHintShown = false;

export function configHint(): string {
  if (IS_CONFIGURED || configHintShown) return "";
  configHintShown = true;
  return (
    "⚠️ No DEEPTUTOR_* env vars detected; running in local-deployment mode (deeptutor CLI on PATH).\n" +
    '   Local deployment: optionally export DEEPTUTOR_LOCAL_BIN="/path/to/deeptutor"\n' +
    '   Remote deployment: export DEEPTUTOR_SSH_HOST="your-ssh-alias" plus DEEPTUTOR_REMOTE_BIN / DEEPTUTOR_REMOTE_HOME\n' +
    "   (See the SKILL's Configuration section; changing server only requires env vars)\n"
  );
}

export function configGuide(): string {
  return (
    "\n--- Configuration troubleshooting ---\n" +
    "Local deployment (deeptutor installed on this machine):\n" +
    '   export DEEPTUTOR_LOCAL_BIN="deeptutor" (local CLI path, optional)\n' +
    "   Note: do NOT set DEEPTUTOR_SSH_HOST (empty = local mode)\n" +
    "   Verify the CLI works: deeptutor kb list --format json\n" +
    "Remote deployment (deeptutor on a server, driven over SSH):\n" +
    '   export DEEPTUTOR_SSH_HOST="your-ssh-alias"\n' +
    '   export DEEPTUTOR_REMOTE_BIN="remote-deeptutor-binary-path"\n' +
    '   export DEEPTUTOR_REMOTE_HOME="remote-DEEPTUTOR_HOME-workspace"\n' +
    "   Verify passwordless SSH login works (ssh alias + BatchMode)\n" +
    "   Verify the remote CLI works: ssh <alias> <DEEPTUTOR_REMOTE_BIN> kb list --format json\n" +
    "DeepTutor 1.7+: the kb / notebook commands and most capabilities need their modules\n" +
    "   installed and enabled (check with: deeptutor module list).\n" +
    'PowerShell users: use $env:VAR="value" instead of export VAR=value.\n' +
    "Restart the agent after configuring.\n"
  );
}

export const CAPABILITIES = [
  "chat",
  "deep_solve",
  "deep_question",
  "deep_research",
  "visualize",
  "math_animator",
  "mastery_path",
] as const;

export const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} chars total]` : s;

/**
 * DeepTutor bridge: shared configuration (env vars) and small helpers.
 *
 * Config (optional env vars, agent-agnostic):
 *   DEEPTUTOR_SSH_HOST    SSH host alias (remote deployment; unset/empty = local deployment)
 *   DEEPTUTOR_API_BASE    API base URL (default http://127.0.0.1:8001, local or tunnel port)
 *   DEEPTUTOR_LOCAL_BIN   local deeptutor executable (local CLI fallback; default: deeptutor on PATH)
 *   DEEPTUTOR_REMOTE_BIN  remote deeptutor binary path (remote CLI fallback)
 *   DEEPTUTOR_REMOTE_HOME remote DEEPTUTOR_HOME workspace (remote)
 */
export const SSH_HOST = process.env.DEEPTUTOR_SSH_HOST ?? "";
export const API_BASE = process.env.DEEPTUTOR_API_BASE ?? "http://127.0.0.1:8001";
export const TUNNEL_PORT = Number(new URL(API_BASE).port || 8001);
export const LOCAL_BIN = process.env.DEEPTUTOR_LOCAL_BIN ?? "deeptutor";
export const DEEPTUTOR_BIN =
  process.env.DEEPTUTOR_REMOTE_BIN ?? "/home/ubuntu/my-deeptutor/.venv/bin/deeptutor";
export const DEEPTUTOR_HOME = process.env.DEEPTUTOR_REMOTE_HOME ?? "/home/ubuntu/my-deeptutor";

// Whether the user explicitly configured anything (show a one-time hint when not)
const IS_CONFIGURED = Boolean(
  process.env.DEEPTUTOR_SSH_HOST ||
    process.env.DEEPTUTOR_API_BASE ||
    process.env.DEEPTUTOR_LOCAL_BIN ||
    process.env.DEEPTUTOR_REMOTE_BIN ||
    process.env.DEEPTUTOR_REMOTE_HOME,
);
let configHintShown = false;

export function configHint(): string {
  if (IS_CONFIGURED || configHintShown) return "";
  configHintShown = true;
  return (
    "⚠️ No DEEPTUTOR_* env vars detected; running in local-deployment mode (local serve / local CLI).\n" +
    '   Local deployment: export DEEPTUTOR_API_BASE="http://127.0.0.1:8001" (serve port; optional DEEPTUTOR_LOCAL_BIN)\n' +
    '   Remote deployment: export DEEPTUTOR_SSH_HOST="your-ssh-alias" plus DEEPTUTOR_API_BASE\n' +
    "   (See the SKILL's Configuration section; changing server/port only requires env vars)\n"
  );
}

export function configGuide(): string {
  return (
    "\n--- Configuration troubleshooting ---\n" +
    "Local deployment (deeptutor runs on this machine):\n" +
    '   export DEEPTUTOR_API_BASE="http://127.0.0.1:8001" (serve port)\n' +
    '   export DEEPTUTOR_LOCAL_BIN="deeptutor" (local CLI path, optional)\n' +
    "   Note: do NOT set DEEPTUTOR_SSH_HOST (empty = local mode)\n" +
    "   Verify serve is running: curl http://127.0.0.1:8001/api/v1/system/status\n" +
    "Remote deployment (deeptutor on a server):\n" +
    '   export DEEPTUTOR_SSH_HOST="your-ssh-alias"\n' +
    '   export DEEPTUTOR_API_BASE="http://127.0.0.1:8001" (local tunnel address; port must match the server\'s serve)\n' +
    '   export DEEPTUTOR_REMOTE_BIN="remote-deeptutor-binary-path"\n' +
    '   export DEEPTUTOR_REMOTE_HOME="remote-DEEPTUTOR_HOME-workspace"\n' +
    "   Verify serve is running on the server (ssh to it: curl http://127.0.0.1:8001/api/v1/system/status)\n" +
    "   Verify passwordless SSH login works (ssh alias + BatchMode)\n" +
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

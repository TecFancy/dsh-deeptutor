/**
 * DeepTutor bridge: HTTP/WS transport (API probing, SSH tunnel management, JSON calls).
 */
import { spawn } from "node:child_process";
import { API_BASE, SSH_HOST, TUNNEL_PORT } from "./config.ts";

let tunnelProc: ReturnType<typeof spawn> | null = null;

/** Kill the SSH tunnel process, if one is running (call on plugin disposal). */
export function killTunnel(): void {
  if (tunnelProc && tunnelProc.exitCode === null) {
    try {
      tunnelProc.kill();
    } catch {}
    tunnelProc = null;
  }
}

export async function apiProbe(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/system/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure the local API is reachable: probe → start SSH tunnel if needed (remote only) → wait. */
export async function ensureApi(): Promise<boolean> {
  if (await apiProbe(1200)) return true;
  if (!SSH_HOST) return false; // Local deployment: fall back to local CLI when serve is down, no tunnel needed
  let tunnelDead = false;
  if (!tunnelProc || tunnelProc.exitCode !== null) {
    tunnelProc = spawn(
      "ssh",
      [
        "-N",
        "-L",
        `${TUNNEL_PORT}:127.0.0.1:${TUNNEL_PORT}`,
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "ConnectTimeout=10",
        SSH_HOST,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    // Fast-fail: a tunnel that exits immediately (bad alias, port in use,
    // refused connection) is not going to recover — stop waiting for it.
    tunnelProc.once("exit", () => {
      tunnelDead = true;
      tunnelProc = null;
    });
    tunnelProc.unref();
  }
  for (let i = 0; i < 20; i++) {
    if (tunnelDead) return false;
    if (await apiProbe(1000)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** JSON fetch against the DeepTutor API. Combines a fixed timeout with an optional caller-supplied abort signal. */
export async function apiJson(
  path: string,
  init?: RequestInit,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  // An already-aborted signal never fires its "abort" event again — check the
  // flag first so a pre-aborted call fails immediately instead of running to
  // completion against a still-open controller.
  if (opts.signal?.aborted) {
    controller.abort();
  } else {
    opts.signal?.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

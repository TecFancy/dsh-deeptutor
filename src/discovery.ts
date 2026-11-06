/**
 * DeepTutor bridge: runtime discovery of the capabilities a deployment offers.
 *
 * DeepTutor 1.7 ships capabilities as optional modules, so the set differs per
 * deployment and grows with every release. Instead of a hard-coded enum the
 * plugin asks `deeptutor module list` (JSON) which modules are ready and what
 * capabilities they provide, and caches the answer for a few minutes.
 *
 * Discovery is advisory: a capability that no module lists may still come from a
 * DeepTutor plugin, so an unknown name is passed through to the CLI. Only a
 * capability whose module is known but not ready is refused up front, because
 * that run is certain to fail and the reason is worth telling the agent.
 */
import { runCli, type CliResult } from "./cli-exec.ts";

export interface ModuleInfo {
  id: string;
  ready: boolean;
  capabilities: string[];
  issues: string[];
}

export interface CapabilityIndex {
  /** Capabilities whose module is installed, enabled and ready. */
  ready: string[];
  /** Capabilities whose module exists but is not ready → module id + reason. */
  unavailable: Record<string, { module: string; reason: string }>;
}

/** Parse `deeptutor module list` output (a JSON array). Tolerates leading noise. Pure. */
export function parseModuleList(stdout: string): ModuleInfo[] | undefined {
  const start = stdout.indexOf("[");
  if (start < 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw)) return undefined;
  const out: ModuleInfo[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || typeof (m as any).id !== "string") continue;
    const r = m as Record<string, unknown>;
    out.push({
      id: r.id as string,
      ready: r.installed === true && r.enabled === true && r.ready === true,
      capabilities: Array.isArray(r.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === "string")
        : [],
      issues: Array.isArray(r.issues) ? r.issues.map((i) => String(i)) : [],
    });
  }
  return out;
}

/** Fold module infos into a capability index. Pure. */
export function indexCapabilities(modules: ModuleInfo[]): CapabilityIndex {
  const ready = new Set<string>();
  const unavailable: CapabilityIndex["unavailable"] = {};
  for (const m of modules) {
    for (const cap of m.capabilities) {
      if (m.ready) ready.add(cap);
      else
        unavailable[cap] = {
          module: m.id,
          reason: m.issues.length ? m.issues.join("; ") : "module not installed or not enabled",
        };
    }
  }
  for (const cap of ready) delete unavailable[cap];
  return { ready: [...ready].sort(), unavailable };
}

const CACHE_MS = 5 * 60_000;
let cache: { at: number; index: CapabilityIndex } | undefined;

/**
 * Current capability index, cached for 5 minutes. Returns undefined when the
 * deployment cannot tell (old DeepTutor without `module list`, CLI unreachable).
 */
export async function discoverCapabilities(
  signal?: AbortSignal,
  run: (args: string[], opts: { signal?: AbortSignal; timeoutMs?: number }) => Promise<CliResult> = runCli,
  now: () => number = Date.now,
): Promise<CapabilityIndex | undefined> {
  if (cache && now() - cache.at < CACHE_MS) return cache.index;
  const res = await run(["module", "list"], { signal, timeoutMs: 60_000 });
  if (res.code !== 0) return undefined;
  const modules = parseModuleList(res.stdout);
  if (!modules) return undefined;
  const index = indexCapabilities(modules);
  cache = { at: now(), index };
  return index;
}

/** Test hook: forget the cached index. */
export function resetCapabilityCache() {
  cache = undefined;
}

/** One line listing the ready capabilities, for tool results and errors. */
export function describeCapabilities(index: CapabilityIndex | undefined): string {
  if (!index) return "Available capabilities: unknown (run `deeptutor module list` to check).";
  const off = Object.entries(index.unavailable)
    .map(([cap, u]) => `${cap} (module ${u.module}: ${u.reason})`)
    .join(", ");
  return (
    `Available capabilities: ${index.ready.join(", ") || "(none)"}` +
    (off ? `\nNot ready on this deployment: ${off}` : "")
  );
}

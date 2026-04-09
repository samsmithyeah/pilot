/**
 * TCP port utilities shared by the CLI and the parallel dispatcher.
 *
 * Lives in its own module to avoid pulling cli.ts (and its heavy import
 * graph) into dispatcher.ts.
 */

import { execFileSync, spawnSync } from 'node:child_process';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Find PIDs listening on a TCP port. Works on macOS (lsof) and Linux (fuser). */
export function findPidsOnPort(port: string | number): number[] {
  try {
    if (process.platform === 'darwin') {
      return execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
    }
    // Linux: fuser writes PIDs to stderr
    const result = spawnSync('fuser', [`${port}/tcp`], { encoding: 'utf-8' });
    const output = (result.stderr || '').trim();
    return output.split(/\s+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

/**
 * Free a TCP host port we're about to use as an agent forward target by
 * killing any stale process listening on it. The common offender is a
 * leftover iOS `PilotAgent` (XCUITest socket server) from a previous iOS
 * run — its host-localhost socket squats on the port we want to use for
 * `adb forward`, silently shadowing the Android agent and routing every
 * subsequent command to the wrong device. The same issue can happen with
 * a leftover `pilot-core` daemon from a crashed previous run.
 *
 * We only kill processes whose command name matches a known stale-agent
 * pattern (`PilotAgen`, `pilot-core`, `xctest`) so we never touch
 * unrelated user processes.
 */
export function freeStaleAgentPort(port: number): void {
  const pids = findPidsOnPort(port);
  if (pids.length === 0) return;

  const stalePatterns = /PilotAgen|pilot-core|xctest/;
  for (const pid of pids) {
    try {
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf-8' }).trim();
      if (!stalePatterns.test(cmd)) continue;
      process.stderr.write(`${DIM}Freeing agent port ${port} from stale ${cmd} (pid ${pid}).${RESET}\n`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    } catch {
      // ps failed (process gone) — nothing to do
    }
  }
}

/**
 * iOS simulator management utilities.
 *
 * Parallel to `emulator.ts` for Android, this module wraps `xcrun simctl`
 * commands for discovering, booting, and managing iOS simulators.
 */

import { execFileSync } from 'node:child_process';

export interface SimulatorInfo {
  udid: string
  name: string
  state: string
  isAvailable: boolean
  runtime: string
}

/**
 * List all available iOS simulators.
 * Returns only simulators marked as available by Xcode.
 */
export function listSimulators(): SimulatorInfo[] {
  try {
    const output = execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const parsed = JSON.parse(output) as {
      devices: Record<string, Array<{
        udid: string
        name: string
        state: string
        isAvailable: boolean
      }>>
    };

    const simulators: SimulatorInfo[] = [];
    for (const [runtime, devices] of Object.entries(parsed.devices)) {
      for (const device of devices) {
        if (device.isAvailable) {
          simulators.push({
            udid: device.udid,
            name: device.name,
            state: device.state,
            isAvailable: device.isAvailable,
            runtime,
          });
        }
      }
    }

    return simulators;
  } catch {
    return [];
  }
}

/**
 * List booted iOS simulators.
 */
export function listBootedSimulators(): SimulatorInfo[] {
  return listSimulators().filter((s) => s.state === 'Booted');
}

/**
 * Boot a simulator by UDID.
 */
export function bootSimulator(udid: string): void {
  try {
    execFileSync('xcrun', ['simctl', 'boot', udid], {
      timeout: 30_000,
    });
  } catch (err) {
    // "Unable to boot device in current state: Booted" is not an error.
    // Check both the error message and stderr output.
    const errObj = err as { message?: string; stderr?: Buffer | string };
    const msg = errObj.message ?? '';
    const stderr = errObj.stderr?.toString() ?? '';
    if (!msg.includes('Booted') && !stderr.includes('Booted')) {
      throw err;
    }
  }
}

/**
 * Shutdown a simulator by UDID.
 */
export function shutdownSimulator(udid: string): void {
  try {
    execFileSync('xcrun', ['simctl', 'shutdown', udid], {
      timeout: 10_000,
      stdio: 'ignore',
    });
  } catch {
    // Shutting down an already-shutdown simulator is fine
  }
}

/**
 * Install an app bundle on a simulator.
 */
export function installApp(udid: string, appPath: string): void {
  execFileSync('xcrun', ['simctl', 'install', udid, appPath], {
    timeout: 60_000,
    stdio: 'ignore',
  });
}

/**
 * Check whether an app bundle is already installed on a simulator.
 */
export function isAppInstalled(udid: string, bundleId: string): boolean {
  try {
    execFileSync('xcrun', ['simctl', 'get_app_container', udid, bundleId, 'app'], {
      timeout: 10_000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a simulator matching the given name (or UDID).
 * Prefers booted simulators. Returns undefined if no match found.
 */
export function findSimulator(nameOrUdid: string): SimulatorInfo | undefined {
  const all = listSimulators();

  // Try exact UDID match first
  const byUdid = all.find((s) => s.udid === nameOrUdid);
  if (byUdid) return byUdid;

  // Try name match, preferring booted ones
  const byName = all.filter((s) => s.name === nameOrUdid);
  const booted = byName.find((s) => s.state === 'Booted');
  if (booted) return booted;

  return byName[0];
}

/**
 * Provision a simulator for testing: find by name, boot if needed, install app.
 * Returns the UDID of the booted simulator.
 */
export function provisionSimulator(
  simulatorName: string,
  appPath?: string,
): string {
  const sim = findSimulator(simulatorName);
  if (!sim) {
    throw new Error(
      `No iOS simulator found matching '${simulatorName}'. ` +
        `Run 'xcrun simctl list devices' to see available simulators.`,
    );
  }

  if (sim.state !== 'Booted') {
    bootSimulator(sim.udid);
  }

  if (appPath) {
    installApp(sim.udid, appPath);
  }

  return sim.udid;
}

/**
 * Poll until a simulator reaches the expected state.
 */
function waitForSimulatorState(udid: string, expectedState: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sims = listSimulators();
    const sim = sims.find((s) => s.udid === udid);
    if (sim?.state === expectedState) return;
    // Synchronous sleep — acceptable in provisioning code
    execFileSync('sleep', ['0.5'], { timeout: 2_000 });
  }
}

// ─── Parallel provisioning ───

export interface ClonedSimulator {
  udid: string
  name: string
  cloned: boolean
}

export interface ProvisionSimulatorsResult {
  /** All simulator UDIDs available for workers (existing booted + newly booted/cloned). */
  allUdids: string[]
  /** Simulators that were cloned and should be cleaned up after the run. */
  clonedSimulators: ClonedSimulator[]
}

/**
 * Clone a simulator, returning the new UDID.
 */
export function cloneSimulator(sourceUdid: string, newName: string): string {
  const output = execFileSync('xcrun', ['simctl', 'clone', sourceUdid, newName], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  // simctl clone prints the new UDID on stdout
  return output.trim();
}

/**
 * Delete a simulator by UDID.
 */
export function deleteSimulator(udid: string): void {
  try {
    shutdownSimulator(udid);
    execFileSync('xcrun', ['simctl', 'delete', udid], {
      timeout: 30_000,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Provision multiple iOS simulators for parallel test execution.
 *
 * Strategy:
 * 1. Start with already-booted simulators matching the name
 * 2. Boot any shutdown simulators that match the name
 * 3. If still not enough, clone the source simulator to create new instances
 *
 * Returns UDIDs for all provisioned simulators.
 */
export function provisionSimulators(opts: {
  /** Simulator name to match (e.g. "iPhone 16"). */
  simulatorName: string
  /** Number of simulators needed. */
  workers: number
  /** UDIDs already assigned to existing workers — skip these. */
  existingUdids?: string[]
}): ProvisionSimulatorsResult {
  const { simulatorName, workers, existingUdids = [] } = opts;
  const existingSet = new Set(existingUdids);
  const allUdids = [...existingUdids];
  const clonedSimulators: ClonedSimulator[] = [];

  if (allUdids.length >= workers) {
    return { allUdids: allUdids.slice(0, workers), clonedSimulators };
  }

  const all = listSimulators();
  const matching = all.filter((s) => s.name === simulatorName && !existingSet.has(s.udid));

  // Phase 0: collect already-booted simulators not yet assigned
  const alreadyBooted = matching.filter((s) => s.state === 'Booted');
  for (const sim of alreadyBooted) {
    if (allUdids.length >= workers) break;
    allUdids.push(sim.udid);
  }

  if (allUdids.length >= workers) {
    return { allUdids: allUdids.slice(0, workers), clonedSimulators };
  }

  // Phase 1: boot any shutdown simulators that match the name
  const shutdown = matching.filter((s) => s.state === 'Shutdown');
  for (const sim of shutdown) {
    if (allUdids.length >= workers) break;
    bootSimulator(sim.udid);
    allUdids.push(sim.udid);
  }

  if (allUdids.length >= workers) {
    return { allUdids: allUdids.slice(0, workers), clonedSimulators };
  }

  // Phase 2: clone the source simulator to create new instances.
  // simctl clone requires a shutdown source. Prefer a shutdown one; if all
  // matching sims are booted, temporarily shut one down for cloning.
  const refreshed = listSimulators();
  let source = refreshed.find((s) => s.name === simulatorName && s.state === 'Shutdown');
  let shutdownForClone = false;
  if (!source) {
    // All matching sims are booted — shut one down temporarily to use as clone source.
    // Remove it from allUdids since it will be unavailable during cloning.
    source = refreshed.find((s) => s.name === simulatorName);
    if (source && source.state === 'Booted') {
      shutdownSimulator(source.udid);
      // Wait for the shutdown to take effect — simctl can return before
      // the state fully propagates, causing clone to fail.
      waitForSimulatorState(source.udid, 'Shutdown', 10_000);
      shutdownForClone = true;
      // Remove from allUdids since it's temporarily down
      const idx = allUdids.indexOf(source.udid);
      if (idx >= 0) allUdids.splice(idx, 1);
    }
  }

  if (!source) {
    // No simulator to clone from — return what we have
    return { allUdids, clonedSimulators };
  }

  try {
    while (allUdids.length < workers) {
      const cloneIndex = allUdids.length;
      const cloneName = `${simulatorName} (Pilot Worker ${cloneIndex})`;
      try {
        const newUdid = cloneSimulator(source.udid, cloneName);
        bootSimulator(newUdid);
        allUdids.push(newUdid);
        clonedSimulators.push({ udid: newUdid, name: cloneName, cloned: true });
      } catch (err) {
        process.stderr.write(
          `Failed to clone simulator for worker ${cloneIndex}: ${err instanceof Error ? err.message : err}\n`,
        );
        break;
      }
    }
  } finally {
    // Re-boot the source if we shut it down for cloning
    if (shutdownForClone) {
      bootSimulator(source.udid);
    }
  }

  return { allUdids: allUdids.slice(0, workers), clonedSimulators };
}

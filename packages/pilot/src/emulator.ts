/**
 * Emulator lifecycle management for parallel test execution.
 *
 * Provides utilities to discover AVDs, launch emulators on specific ports,
 * wait for boot, and clean up on exit. Used by the dispatcher when
 * `launchEmulators: true` to auto-provision devices for workers.
 *
 * @see PILOT-106
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

const DIM = '\x1b[2m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

// ─── Emulator discovery ───

/**
 * List available Android Virtual Devices (AVDs).
 * Runs `emulator -list-avds` and returns the AVD names.
 */
export function listAvds(): string[] {
  try {
    const output = execFileSync('emulator', ['-list-avds'], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/**
 * Get the AVD name of a running emulator by its serial.
 * Runs `adb -s <serial> emu avd name`.
 */
export function getRunningAvdName(serial: string): string | undefined {
  try {
    const output = execFileSync('adb', ['-s', serial, 'emu', 'avd', 'name'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Output is "AVD_NAME\nOK\n"
    const lines = output.trim().split('\n')
    return lines[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

// ─── Emulator port management ───

/** Base port for emulator console (even ports: 5554, 5556, 5558, ...) */
const BASE_EMULATOR_PORT = 5554

/**
 * Find the next available emulator console port.
 * Emulator ports must be even numbers. The ADB serial will be `emulator-{port}`.
 */
export function findAvailablePort(usedPorts: Set<number>): number {
  let port = BASE_EMULATOR_PORT
  while (usedPorts.has(port)) {
    port += 2
  }
  return port
}

/**
 * Get the serial for a given emulator console port.
 */
export function serialForPort(port: number): string {
  return `emulator-${port}`
}

// ─── Emulator launch ───

export interface LaunchedEmulator {
  process: ChildProcess
  port: number
  serial: string
  avd: string
}

/**
 * Launch an emulator instance for the given AVD on the specified port.
 * Returns immediately — use `waitForBoot` to wait until the device is ready.
 */
export function launchEmulator(avd: string, port: number): LaunchedEmulator {
  const serial = serialForPort(port)

  const proc = spawn('emulator', [
    '-avd', avd,
    '-port', String(port),
    '-read-only',
    '-no-snapshot-save',
    '-no-boot-anim',
    '-no-audio',
    '-gpu', 'swiftshader_indirect',
  ], {
    detached: true,
    stdio: 'ignore',
  })

  proc.unref()

  proc.on('error', () => {
    // Handled by waitForBoot timeout
  })

  return { process: proc, port, serial, avd }
}

/**
 * Wait for an emulator to finish booting.
 * Polls `adb -s <serial> shell getprop sys.boot_completed` until it returns "1".
 */
export async function waitForBoot(serial: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now()
  const pollInterval = 2_000

  // First wait for the device to appear in ADB
  while (Date.now() - start < timeoutMs) {
    try {
      execFileSync('adb', ['-s', serial, 'wait-for-device'], {
        timeout: 10_000,
        stdio: 'ignore',
      })
      break
    } catch {
      await sleep(pollInterval)
    }
  }

  // Then wait for boot_completed
  while (Date.now() - start < timeoutMs) {
    try {
      const result = execFileSync(
        'adb',
        ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
        { encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      if (result.trim() === '1') {
        return
      }
    } catch {
      // Device not ready yet
    }
    await sleep(pollInterval)
  }

  throw new Error(`Emulator ${serial} did not boot within ${timeoutMs / 1000}s`)
}

// ─── Emulator shutdown ───

/**
 * Kill an emulator by serial.
 */
export function killEmulator(serial: string): void {
  try {
    execFileSync('adb', ['-s', serial, 'emu', 'kill'], {
      timeout: 10_000,
      stdio: 'ignore',
    })
  } catch {
    // Best effort — emulator may already be dead
  }
}

// ─── High-level orchestration ───

export interface ProvisionResult {
  launched: LaunchedEmulator[]
  allSerials: string[]
}

/**
 * Ensure enough emulators are running to satisfy the requested worker count.
 *
 * - Discovers already-running devices from the provided list
 * - Launches additional emulators if `launchEmulators` is true and an `avd` is specified
 * - Returns the full list of device serials and handles to launched emulators (for cleanup)
 */
export async function provisionEmulators(opts: {
  existingSerials: string[]
  workers: number
  avd?: string
}): Promise<ProvisionResult> {
  const { existingSerials, workers, avd } = opts
  const needed = workers - existingSerials.length

  if (needed <= 0) {
    return { launched: [], allSerials: existingSerials.slice(0, workers) }
  }

  if (!avd) {
    // Try to auto-detect: use the first available AVD
    const avds = listAvds()
    if (avds.length === 0) {
      throw new Error(
        `Need ${needed} more emulator(s) but no AVDs found. ` +
        'Create an AVD with Android Studio or `avdmanager`, or set the `avd` config option.',
      )
    }
    process.stderr.write(
      `${YELLOW}No avd specified in config. Use the 'avd' config option to control which AVD is launched.${RESET}\n`,
    )
    return provisionEmulators({ ...opts, avd: avds[0] })
  }

  // Verify the AVD exists
  const avds = listAvds()
  if (!avds.includes(avd)) {
    throw new Error(
      `AVD "${avd}" not found. Available AVDs: ${avds.join(', ') || '(none)'}`,
    )
  }

  // Check if existing emulators are using the same AVD — Android emulator
  // doesn't allow two instances of the same AVD unless both use -read-only,
  // and we can't change the flags on an already-running emulator.
  const runningAvds = new Set<string>()
  for (const serial of existingSerials) {
    if (serial.startsWith('emulator-')) {
      const name = getRunningAvdName(serial)
      if (name) runningAvds.add(name)
    }
  }

  let effectiveAvd = avd
  if (runningAvds.has(avd)) {
    // The requested AVD is already running — find an alternative
    const alternatives = avds.filter((a) => a !== avd && !runningAvds.has(a))
    if (alternatives.length > 0) {
      effectiveAvd = alternatives[0]
      process.stderr.write(
        `${YELLOW}AVD "${avd}" is already running. Using "${effectiveAvd}" for new emulator(s) instead.${RESET}\n`,
      )
    } else {
      throw new Error(
        `Cannot launch another instance of AVD "${avd}" — it is already running ` +
        'and no alternative AVDs are available. Android requires all instances of ' +
        'the same AVD to be started with -read-only. Either:\n' +
        '  1. Create a second AVD in Android Studio\n' +
        '  2. Start your base emulator with: emulator -avd ' + avd + ' -read-only',
      )
    }
  }

  // Determine which ports are already in use
  const usedPorts = new Set<number>()
  for (const serial of existingSerials) {
    const match = serial.match(/^emulator-(\d+)$/)
    if (match) {
      usedPorts.add(parseInt(match[1], 10))
    }
  }

  // Launch emulators
  const launched: LaunchedEmulator[] = []
  process.stderr.write(
    `${DIM}Launching ${needed} emulator(s) (AVD: ${effectiveAvd})...${RESET}\n`,
  )

  for (let i = 0; i < needed; i++) {
    const port = findAvailablePort(usedPorts)
    usedPorts.add(port)
    const emu = launchEmulator(effectiveAvd, port)
    launched.push(emu)
    process.stderr.write(`${DIM}  Starting ${emu.serial} (port ${port})${RESET}\n`)
  }

  // Wait for all emulators to boot in parallel
  process.stderr.write(`${DIM}Waiting for emulator(s) to boot...${RESET}\n`)
  await Promise.all(launched.map((emu) => waitForBoot(emu.serial)))
  process.stderr.write(`${DIM}All emulators ready.${RESET}\n`)

  const allSerials = [
    ...existingSerials,
    ...launched.map((emu) => emu.serial),
  ].slice(0, workers)

  return { launched, allSerials }
}

/**
 * Shut down all emulators that were launched by `provisionEmulators`.
 */
export function cleanupEmulators(launched: LaunchedEmulator[]): void {
  for (const emu of launched) {
    killEmulator(emu.serial)
    try {
      emu.process.kill()
    } catch {
      // Already dead
    }
  }
}

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

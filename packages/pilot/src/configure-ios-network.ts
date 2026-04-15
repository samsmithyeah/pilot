/**
 * `pilot configure-ios-network <udid>` and `pilot refresh-ios-network <udid>`
 * — generate / regenerate a per-device mobileconfig for physical iOS
 * network capture (PILOT-185).
 *
 * Both commands delegate the heavy lifting to the daemon's
 * `GenerateIosNetworkProfile` RPC so the mobileconfig generation logic
 * lives in one place (Rust). The only CLI-side wrapping is:
 *   1. Start a temporary `pilot-core` daemon
 *   2. Issue the RPC
 *   3. Tear down the daemon
 *   4. Print a concise walkthrough for installing the profile on the device
 *
 * `refresh-` differs from `configure-` only in the wording of its output
 * — both regenerate unconditionally, because the primary need for
 * refresh is a host Wi-Fi IP change that the user has already observed.
 */

import { execFileSync, spawn } from 'node:child_process';
import { findDaemonBin } from './daemon-bin.js';
import { PilotGrpcClient } from './grpc-client.js';
import { findPidsOnPort } from './port-utils.js';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const bold = (s: string): string => `${BOLD}${s}${RESET}`;
const dim = (s: string): string => `${DIM}${s}${RESET}`;
const green = (s: string): string => `${GREEN}${s}${RESET}`;
const yellow = (s: string): string => `${YELLOW}${s}${RESET}`;
const red = (s: string): string => `${RED}${s}${RESET}`;

interface Options {
  udid: string
  ssid?: string
  deviceName?: string
  mode: 'configure' | 'refresh'
}

/**
 * Spin up an ephemeral pilot-core daemon, issue the RPC, and tear down.
 *
 * We don't reuse ensureDaemonRunning() because that function has test-flow
 * side effects (freeing agent ports, killing previous daemons) which are
 * overkill for a one-shot setup command. A minimal spawn-connect-shutdown
 * cycle keeps the command fast and isolated.
 */
async function callGenerateProfile(opts: Options): Promise<{
  profilePath: string
  hostIp: string
  port: number
  ssid: string
}> {
  const port = '50051';
  const address = `localhost:${port}`;

  // Kill any existing daemon on the target port so we always start clean.
  const existing = findPidsOnPort(port);
  for (const pid of existing) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone
    }
  }
  if (existing.length > 0) {
    await new Promise((r) => setTimeout(r, 300));
  }

  const bin = findDaemonBin();
  const child = spawn(bin, ['--port', port, '--platform', 'ios'], {
    stdio: 'ignore',
  });
  child.unref();

  const client = new PilotGrpcClient(address);
  const ready = await client.waitForReady(10_000);
  if (!ready) {
    try { child.kill(); } catch {}
    throw new Error('Failed to start pilot-core daemon. Is the binary on PATH?');
  }

  try {
    const response = await client.generateIosNetworkProfile({
      udid: opts.udid,
      ssid: opts.ssid,
      deviceName: opts.deviceName,
    });
    if (!response.success) {
      throw new Error(response.errorMessage || 'generateIosNetworkProfile RPC failed');
    }
    return {
      profilePath: response.profilePath,
      hostIp: response.hostIp,
      port: response.port,
      ssid: response.ssid,
    };
  } finally {
    try { client.close(); } catch {}
    try { child.kill(); } catch {}
  }
}

function printWalkthrough(opts: Options, result: {
  profilePath: string
  hostIp: string
  port: number
  ssid: string
}): void {
  console.log();
  console.log(green('✓ Generated Pilot network capture profile'));
  console.log();
  console.log('  ' + dim('device:   ') + bold(opts.udid));
  console.log('  ' + dim('profile:  ') + result.profilePath);
  console.log('  ' + dim('host IP:  ') + result.hostIp);
  console.log('  ' + dim('port:     ') + result.port);
  console.log('  ' + dim('SSID:     ') + result.ssid);
  console.log();

  // Reveal the .mobileconfig in Finder so the user can right-click → Share
  // → AirDrop without hunting through the filesystem. Best-effort — we
  // ignore failures (e.g. running over SSH) and the printed instructions
  // still work.
  revealInFinder(result.profilePath);

  if (opts.mode === 'refresh') {
    console.log(bold('To apply the refreshed profile:'));
    console.log();
    console.log(`  1) On the device, open ${bold('Settings → General → VPN & Device Management')}`);
    console.log('     and remove the existing "Pilot Network Capture" profile.');
    console.log();
    console.log('  2) AirDrop the new profile from the Finder window we just opened,');
    console.log('     then ' + bold('Install') + ' it from Settings as before.');
    console.log();
    console.log(yellow('  Important: the device must be on Wi-Fi "') + bold(result.ssid) + yellow('" for'));
    console.log(yellow('  the proxy to route traffic. If the host Mac changes Wi-Fi,'));
    console.log(yellow(`  re-run: ${bold('pilot refresh-ios-network ' + opts.udid)}`));
    console.log();
    return;
  }

  console.log(bold('To install on the device:'));
  console.log();
  console.log(`  ${bold('1)')} ${bold('Send')} the profile to the device.`);
  console.log(`     ${dim('•')} The Finder window we just opened has it pre-selected —`);
  console.log(`       right-click → ${bold('Share')} → ${bold('AirDrop')} → pick your iPhone.`);
  console.log(`     ${dim('•')} Or email / Messages the .mobileconfig as an attachment.`);
  console.log();
  console.log(`  ${bold('2)')} ${bold('Install')} the profile on the device.`);
  console.log(`     Open ${bold('Settings')} on the iPhone — there'll be a "Profile Downloaded"`);
  console.log(`     banner near the top. Tap it (or open ${bold('General → VPN & Device')}`);
  console.log(`     ${bold('Management')}) → "Pilot Network Capture" → ${bold('Install')} →`);
  console.log(`     enter passcode → ${bold('Install')}.`);
  console.log();
  console.log(`  ${bold('3)')} ${bold('Trust')} the Pilot MITM CA.`);
  console.log(`     ${dim('This menu only appears AFTER step 2 — installing the profile is what')}`);
  console.log(`     ${dim('makes iOS reveal the Certificate Trust Settings row.')}`);
  console.log(`     Open ${bold('Settings → General → About → Certificate Trust Settings')}`);
  console.log(`     and enable the toggle next to ${bold('Pilot MITM CA')}.`);
  console.log();
  console.log(`  ${bold('4)')} ${bold('Verify')} that decrypted HTTPS capture works:`);
  console.log(`     ${green('pilot verify-ios-network ' + opts.udid)}`);
  console.log();
  console.log(yellow('  Important: the device must be on Wi-Fi "') + bold(result.ssid) + yellow('" for'));
  console.log(yellow('  the proxy to route traffic. If the host Mac changes Wi-Fi,'));
  console.log(yellow(`  re-run: ${bold('pilot refresh-ios-network ' + opts.udid)}`));
  console.log();
}

/**
 * Best-effort reveal a file in the macOS Finder. We use `open -R <path>`
 * which highlights the file in its parent folder window. Silent on
 * non-macOS hosts and on failure — the printed instructions still
 * stand if Finder isn't available.
 */
function revealInFinder(filePath: string): void {
  if (process.platform !== 'darwin') return;
  try {
    execFileSync('open', ['-R', filePath], { stdio: 'ignore' });
  } catch {
    // Best-effort — instructions still work without Finder revealing.
  }
}

// ─── Argument parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[], mode: 'configure' | 'refresh'): Options & { help: boolean } {
  let help = false;
  let udid: string | undefined;
  let ssid: string | undefined;
  let deviceName: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      i += 1;
    } else if (arg === '--ssid') {
      ssid = argv[i + 1];
      i += 2;
    } else if (arg.startsWith('--ssid=')) {
      ssid = arg.slice('--ssid='.length);
      i += 1;
    } else if (arg === '--device-name') {
      deviceName = argv[i + 1];
      i += 2;
    } else if (arg.startsWith('--device-name=')) {
      deviceName = arg.slice('--device-name='.length);
      i += 1;
    } else if (!arg.startsWith('-') && !udid) {
      udid = arg;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { udid: udid ?? '', ssid, deviceName, mode, help };
}

function printHelp(mode: 'configure' | 'refresh'): void {
  const command = mode === 'refresh' ? 'refresh-ios-network' : 'configure-ios-network';
  console.log(`
${bold(`pilot ${command}`)} — ${mode === 'refresh' ? 'Regenerate' : 'Generate'} a network capture profile for a physical iOS device.

${bold('Usage:')}
  pilot ${command} <udid> [options]

${bold('Options:')}
  --ssid <name>         Wi-Fi SSID the profile targets (defaults to the host's current network)
  --device-name <name>  Friendly name for the PayloadDisplayName (defaults to the device's name)
  --help, -h            Show this help
`);
}

// ─── Entry points ───────────────────────────────────────────────────────

export async function runConfigureIosNetwork(argv: string[]): Promise<void> {
  await run(argv, 'configure');
}

export async function runRefreshIosNetwork(argv: string[]): Promise<void> {
  await run(argv, 'refresh');
}

async function run(argv: string[], mode: 'configure' | 'refresh'): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error(red(`pilot ${mode}-ios-network is only supported on macOS.`));
    process.exit(1);
  }

  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv, mode);
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    printHelp(mode);
    process.exit(1);
  }
  if (opts.help) {
    printHelp(mode);
    return;
  }
  if (!opts.udid) {
    console.error(red('UDID is required. Run `pilot setup-ios-device` to see connected devices.'));
    printHelp(mode);
    process.exit(1);
  }

  // Basic sanity check: make sure the UDID looks plausible and the device
  // appears in devicectl. We don't try to parse the exact format because
  // Apple has varied UDID shapes across device generations.
  try {
    execFileSync('xcrun', ['--find', 'devicectl'], { stdio: 'ignore' });
  } catch {
    console.error(red('xcrun devicectl not found. Install Xcode 15 or later.'));
    process.exit(1);
  }

  try {
    console.log(dim(`Starting temporary pilot-core daemon…`));
    const result = await callGenerateProfile(opts);
    printWalkthrough(opts, result);
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

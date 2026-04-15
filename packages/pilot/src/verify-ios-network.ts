/**
 * `pilot verify-ios-network <udid>` — sanity-check that a physical iOS
 * device is correctly routed through Pilot's MITM proxy.
 *
 * Runs the smallest possible end-to-end check:
 *   1. Spin up an ephemeral pilot-core daemon
 *   2. SetDevice → physical iOS UDID
 *   3. StartNetworkCapture
 *   4. Prompt the user to load a known HTTPS URL on the device
 *   5. StopNetworkCapture
 *   6. Inspect the captured entries:
 *      - 0 entries           → device isn't routing through the proxy
 *      - HTTPS entries with empty bodies → proxy sees CONNECT but can't
 *        decrypt; CA isn't trusted on the device
 *      - HTTPS entries with non-empty bodies → fully working
 *   7. Print a clear ✓/✗ summary with fix-it hints for each failure mode
 *
 * Why the user has to load the URL manually: there's no host-side way
 * to make Safari fetch a URL in a way that actually goes through the
 * Wi-Fi proxy without booting a full XCUITest agent (which is heavy
 * for a verification step). Asking the user to tap their address bar
 * for one URL is faster than spinning up an agent session.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { findDaemonBin } from './daemon-bin.js';
import { PilotGrpcClient } from './grpc-client.js';
import { pickFreePort } from './port-utils.js';

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

/** A known HTTPS endpoint with a small, predictable body. */
const PROBE_URL = 'https://example.com/';

interface VerifyOptions {
  udid: string
  help: boolean
}

// ─── Daemon lifecycle ───────────────────────────────────────────────────

async function withDaemon<T>(fn: (client: PilotGrpcClient) => Promise<T>): Promise<T> {
  const port = String(await pickFreePort());
  const bin = findDaemonBin();
  const child = spawn(bin, ['--port', port, '--platform', 'ios'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();

  const client = new PilotGrpcClient(`127.0.0.1:${port}`);
  const ready = await client.waitForReady(5_000);
  if (!ready) {
    try { child.kill(); } catch {}
    throw new Error(
      'Failed to start pilot-core daemon. Is the binary on PATH? ' +
      'Set PILOT_DAEMON_BIN to an explicit path if it lives elsewhere.',
    );
  }
  try {
    return await fn(client);
  } finally {
    try { client.close(); } catch {}
    try { child.kill(); } catch {}
  }
}

// ─── Verification flow ─────────────────────────────────────────────────

async function promptEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

interface VerificationOutcome {
  totalEntries: number
  httpsEntries: number
  decryptedEntries: number
  uniqueHosts: Set<string>
}

async function runVerification(udid: string): Promise<VerificationOutcome> {
  return withDaemon(async (client) => {
    // 1. Switch the daemon to the target device.
    const setRes = await client.setDevice(udid);
    if (!setRes.success) {
      throw new Error(`Failed to select device ${udid}: ${setRes.errorMessage}`);
    }
    console.log(dim(`Device ${udid} selected.`));

    // 2. Start the proxy.
    const startRes = await client.startNetworkCapture();
    if (!startRes.success) {
      throw new Error(`Failed to start network capture: ${startRes.errorMessage}`);
    }
    console.log(dim(`Network capture started on host port ${startRes.proxyPort}.`));
    console.log();

    // 3. Hand off to the user.
    console.log(bold('On your iPhone:'));
    console.log(`  1) Open ${bold('Safari')}.`);
    console.log(`  2) Visit ${bold(PROBE_URL)} (or any HTTPS site).`);
    console.log(`  3) Wait for the page to load.`);
    console.log();
    await promptEnter(`  Press ${bold('Enter')} once the page has loaded… `);
    console.log();

    // 4. Stop and inspect.
    const stopRes = await client.stopNetworkCapture();
    if (!stopRes.success) {
      throw new Error(`Failed to stop network capture: ${stopRes.errorMessage}`);
    }

    const httpsEntries = stopRes.entries.filter((e) => e.isHttps);
    const decrypted = httpsEntries.filter((e) => e.responseBody && e.responseBody.length > 0);
    const uniqueHosts = new Set<string>();
    for (const e of httpsEntries) {
      try {
        uniqueHosts.add(new URL(e.url).host);
      } catch {
        // Skip malformed URLs
      }
    }

    return {
      totalEntries: stopRes.entries.length,
      httpsEntries: httpsEntries.length,
      decryptedEntries: decrypted.length,
      uniqueHosts,
    };
  });
}

function reportOutcome(outcome: VerificationOutcome): boolean {
  console.log();
  console.log(bold('Result:'));
  console.log(`  ${dim('total HTTP requests captured:')} ${outcome.totalEntries}`);
  console.log(`  ${dim('HTTPS requests:')}              ${outcome.httpsEntries}`);
  console.log(`  ${dim('decrypted (with body):')}       ${outcome.decryptedEntries}`);
  if (outcome.uniqueHosts.size > 0) {
    console.log(`  ${dim('hosts seen:')}                  ${[...outcome.uniqueHosts].slice(0, 5).join(', ')}${
      outcome.uniqueHosts.size > 5 ? ` (+${outcome.uniqueHosts.size - 5} more)` : ''
    }`);
  }
  console.log();

  if (outcome.totalEntries === 0) {
    console.log(red('✗ Pilot did not see ANY traffic from the device.'));
    console.log();
    console.log(yellow('  The device is not currently routing through the Pilot proxy.'));
    console.log();
    console.log('  Likely causes:');
    console.log(`  ${dim('•')} The mobileconfig profile isn't installed.`);
    console.log(`  ${dim('•')} The device is on a different Wi-Fi network than when the`);
    console.log(`     profile was generated. Check ${bold('Settings → Wi-Fi')} on the device`);
    console.log(`     and rerun ${bold('pilot refresh-ios-network <udid>')} if it changed.`);
    console.log(`  ${dim('•')} The host Mac's Wi-Fi IP changed since the profile was generated.`);
    console.log(`     Rerun ${bold('pilot refresh-ios-network <udid>')}.`);
    console.log();
    return false;
  }

  if (outcome.httpsEntries === 0) {
    console.log(yellow('⚠ Pilot saw HTTP traffic but no HTTPS — that\'s unusual.'));
    console.log();
    console.log('  Most modern iOS apps and websites use HTTPS exclusively.');
    console.log('  Try loading a known-HTTPS URL like ' + bold(PROBE_URL) + ' and re-run.');
    console.log();
    return false;
  }

  if (outcome.decryptedEntries === 0) {
    console.log(red('✗ HTTPS traffic is reaching the proxy but Pilot can\'t decrypt it.'));
    console.log();
    console.log(yellow('  The Pilot MITM CA is NOT trusted on the device.'));
    console.log();
    console.log('  Fix:');
    console.log(`  ${dim('1)')} On the iPhone open ${bold('Settings → General → About → Certificate')}`);
    console.log(`     ${bold('Trust Settings')}. ${dim('(This row only appears AFTER you install')}`);
    console.log(`     ${dim('a profile that contains a custom CA, which the mobileconfig does.)')}`);
    console.log(`  ${dim('2)')} Toggle on full trust for ${bold('Pilot MITM CA')}.`);
    console.log(`  ${dim('3)')} Re-run ${bold('pilot verify-ios-network')}.`);
    console.log();
    return false;
  }

  console.log(green('✓ Network capture is fully working!'));
  console.log();
  console.log(`  Pilot saw ${bold(String(outcome.httpsEntries))} HTTPS request(s) and decrypted`);
  console.log(`  ${bold(String(outcome.decryptedEntries))} of them. You're ready to run ${bold('pilot test')}`);
  console.log(`  with ${bold("trace: 'on'")} and inspect decrypted HTTPS entries in the trace viewer.`);
  console.log();
  return true;
}

// ─── CLI entry point ────────────────────────────────────────────────────

function parseArgs(argv: string[]): VerifyOptions {
  let help = false;
  let udid: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (!arg.startsWith('-') && !udid) {
      udid = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { udid: udid ?? '', help };
}

function printHelp(): void {
  console.log(`
${bold('pilot verify-ios-network')} — Sanity-check that a physical iOS device is correctly routed through Pilot's MITM proxy.

${bold('Usage:')}
  pilot verify-ios-network <udid>

${bold('What it does:')}
  Starts the Pilot proxy, asks you to load an HTTPS page in Safari on
  the device, then reports whether Pilot saw the request and was able
  to decrypt it. Use this after running ${bold('pilot configure-ios-network')}
  to confirm both the proxy profile and the CA trust are in place
  before running tests.

${bold('Options:')}
  --help, -h    Show this help
`);
}

export async function runVerifyIosNetwork(argv: string[]): Promise<void> {
  let opts: VerifyOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    printHelp();
    process.exit(1);
  }
  if (opts.help) { printHelp(); return; }
  if (!opts.udid) {
    console.error(red('Usage: pilot verify-ios-network <udid>'));
    process.exit(1);
  }

  try {
    const outcome = await runVerification(opts.udid);
    const ok = reportOutcome(outcome);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

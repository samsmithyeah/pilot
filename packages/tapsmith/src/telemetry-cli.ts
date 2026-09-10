/**
 * `tapsmith telemetry [status|enable|disable] [--json] [-c <config>]`
 *
 * The switch users expect from Next.js and Astro: a machine-wide toggle that
 * needs no config edit and no env var, plus a status command that says
 * whether this process would report and which of the three switches (env,
 * config, machine) decided it. See `docs/telemetry.md`.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, configPathOf, type TapsmithConfig } from './config.js';
import { telemetry as defaultTelemetry, TELEMETRY_DOCS_URL, type Telemetry, type TelemetryStatus } from './telemetry.js';

export interface TelemetryCommandDeps {
  telemetry?: Telemetry;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Loads the project config for `status`; swapped out by tests. */
  loadConfig?: (configFile?: string) => Promise<TapsmithConfig>;
}

interface ParsedArgs {
  subcommand: 'status' | 'enable' | 'disable' | undefined;
  json: boolean;
  configFile?: string;
  help: boolean;
  error?: string;
}

function parse(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { subcommand: undefined, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--config' || arg === '-c') {
      const value = argv[++i];
      if (!value) return { ...parsed, error: `${arg} requires a config file path` };
      parsed.configFile = value;
    } else if (arg.startsWith('--config=')) parsed.configFile = arg.slice('--config='.length);
    else if (arg === 'status' || arg === 'enable' || arg === 'disable') {
      if (parsed.subcommand) return { ...parsed, error: `Unexpected argument: ${arg}` };
      parsed.subcommand = arg;
    } else return { ...parsed, error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: tapsmith telemetry [status|enable|disable] [--json] [-c <config>]',
    '',
    '  status    Show whether anonymous usage telemetry is on, and why not if it is off (default)',
    '  enable    Turn it on for this machine (does not override TAPSMITH_TELEMETRY=0 or `telemetry: false`)',
    '  disable   Turn it off for this machine, for every project',
    '',
    `Details: ${TELEMETRY_DOCS_URL}`,
    '',
  ].join('\n');
}

function tilde(file: string): string {
  const home = os.homedir();
  return home && file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

function describe(status: TelemetryStatus, configPath: string | undefined, configError: string | undefined): string {
  const lines: string[] = [];
  if (status.enabled) {
    lines.push(status.debug
      ? 'Telemetry is enabled in dry-run mode: TAPSMITH_TELEMETRY_DEBUG is set, so events print to stderr and nothing is sent.'
      : 'Telemetry is enabled.');
    lines.push('  One anonymous event per test-file run: run mode, platform, pass/fail counts, SDK/Node/OS versions.');
    lines.push('  Never test names, selectors, app identifiers, or file paths.');
    lines.push(`  Anonymous id: ${status.anonymousId ?? '(none yet — created on the first run)'}  (${tilde(status.stateFile)})`);
    lines.push('  Disable: tapsmith telemetry disable · TAPSMITH_TELEMETRY=0 · telemetry: false in tapsmith.config.ts');
  } else {
    const why = status.reason === 'env'
      ? 'TAPSMITH_TELEMETRY or DO_NOT_TRACK is set in this environment'
      : status.reason === 'config'
        ? `telemetry: false in ${configPath ?? 'the config'}`
        : `machine-wide, via \`tapsmith telemetry disable\` (${tilde(status.stateFile)})`;
    lines.push(`Telemetry is disabled (${why}).`);
    if (status.reason === 'machine') lines.push('  Re-enable: tapsmith telemetry enable');
  }
  if (configError) lines.push(`  Note: the config could not be loaded (${configError}); its \`telemetry\` key was not consulted.`);
  lines.push(`  Docs: ${TELEMETRY_DOCS_URL}`);
  return lines.join('\n') + '\n';
}

/** Runs the command and returns the process exit code. */
export async function runTelemetryCommand(argv: string[], deps: TelemetryCommandDeps = {}): Promise<number> {
  const telemetry = deps.telemetry ?? defaultTelemetry;
  const stdout = deps.stdout ?? ((text) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text) => process.stderr.write(text));
  const load = deps.loadConfig ?? ((configFile?: string) => loadConfig(undefined, configFile));

  const args = parse(argv);
  if (args.error) {
    stderr(`${args.error}\n\n${usage()}`);
    return 1;
  }
  if (args.help) {
    stdout(usage());
    return 0;
  }

  if (args.subcommand === 'enable' || args.subcommand === 'disable') {
    const enabling = args.subcommand === 'enable';
    if (!telemetry.setMachineEnabled(enabling)) {
      const status = telemetry.status(undefined);
      stderr(`Could not write ${tilde(status.stateFile)}. `
        + (enabling ? 'Telemetry stays as it was.\n' : 'Set TAPSMITH_TELEMETRY=0 in your shell instead.\n'));
      return 1;
    }
    const status = telemetry.status(undefined);
    if (args.json) {
      stdout(JSON.stringify({ ...status, docs: TELEMETRY_DOCS_URL }, null, 2) + '\n');
      return 0;
    }
    if (enabling) {
      stdout(`Telemetry enabled for this machine (${tilde(status.stateFile)}).\n`);
      if (!status.enabled) {
        stdout(`  Still off here: ${status.reason === 'env'
          ? 'TAPSMITH_TELEMETRY or DO_NOT_TRACK is set in this environment.'
          : 'the project config sets telemetry: false.'}\n`);
      }
    } else {
      stdout(`Telemetry disabled for this machine (${tilde(status.stateFile)}). Re-enable with \`tapsmith telemetry enable\`.\n`);
    }
    return 0;
  }

  // status (the default)
  let config: TapsmithConfig | undefined;
  let configError: string | undefined;
  try {
    config = await load(args.configFile);
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  const status = telemetry.status(config);
  const configPath = config ? configPathOf(config) : undefined;
  if (args.json) {
    stdout(JSON.stringify({ ...status, configPath: configPath ?? null, docs: TELEMETRY_DOCS_URL }, null, 2) + '\n');
  } else {
    stdout(describe(status, configPath, configError));
  }
  return 0;
}

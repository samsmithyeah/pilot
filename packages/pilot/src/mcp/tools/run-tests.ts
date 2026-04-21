import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

let _running = false;

export function registerRunTestsTool(server: McpServer): void {
  server.tool(
    'pilot_run_tests',
    'Run Pilot test files and return structured results. Reports pass/fail counts and detailed failure information including error messages and trace file paths for debugging. Only one test run can execute at a time.',
    {
      files: z.array(z.string()).describe('Test file paths or glob patterns'),
      device: z.string().optional().describe('Device serial (optional)'),
    },
    async ({ files, device }) => {
      if (_running) {
        return {
          content: [{ type: 'text' as const, text: 'A test run is already in progress. Wait for it to finish before starting another.' }],
          isError: true,
        };
      }

      _running = true;
      try {
        const args = ['test', ...files, '--trace', 'on'];
        if (device) args.push('--device', device);

        const result = await runPilotProcess(args);
        return { content: [{ type: 'text' as const, text: result }] };
      } finally {
        _running = false;
      }
    },
  );
}

function runPilotProcess(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('pilot', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', PILOT_REUSE_DAEMON: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      const output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
      if (code !== 0) {
        resolve(`Tests failed (exit code ${code}):\n${output}`);
      } else {
        resolve(output || 'All tests passed.');
      }
    });

    child.on('error', (err) => {
      resolve(`Failed to run pilot: ${err.message}`);
    });
  });
}

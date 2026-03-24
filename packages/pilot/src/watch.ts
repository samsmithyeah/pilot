/**
 * Watch mode coordinator.
 *
 * Watches test files for changes and re-runs them automatically. Keeps
 * the daemon, emulator, and agent alive across re-runs so only the app
 * reset + test execution cost is paid (~1-2s per run).
 *
 * Each re-run forks a child process (`watch-run.ts`) to get a fresh ESM
 * module cache, ensuring all file changes (tests, helpers, page objects)
 * are picked up.
 *
 * @see PILOT-120
 */

import { fork, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import type { PilotConfig } from './config.js'
import type { Device } from './device.js'
import type { PilotGrpcClient } from './grpc-client.js'
import { createReporters, ReporterDispatcher, type FullResult, type PilotReporter } from './reporter.js'
import type { TestResult, SuiteResult } from './runner.js'
import type { ResolvedProject } from './project.js'
import {
  deserializeTestResult,
  deserializeSuiteResult,
  type SerializedConfig,
  type RunFileUseOptions,
} from './worker-protocol.js'
import type { WatchRunMessage, WatchRunChildMessage } from './watch-run.js'
import { preserveEmulatorsForReuse, type LaunchedEmulator } from './emulator.js'

// ─── ANSI helpers ───

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

// ─── Types ───

export interface WatchModeContext {
  config: PilotConfig
  device: Device
  client: PilotGrpcClient
  deviceSerial: string
  daemonAddress: string
  testFiles: string[]
  screenshotDir?: string
  launchedEmulators: LaunchedEmulator[]
  /** Resolved projects with test files populated. */
  projects?: ResolvedProject[]
  /** Dependency-ordered project waves from topologicalSort(). */
  projectWaves?: ResolvedProject[][]
}

// ─── Watch mode coordinator ───

export async function runWatchMode(ctx: WatchModeContext): Promise<void> {
  const state = {
    knownFiles: new Set(ctx.testFiles),
    failedFiles: new Set<string>(),
    lastRunFiles: [] as string[],
    isRunning: false,
    isInitialRun: true,
    pendingFiles: null as Set<string> | 'all' | null,
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
    debounceFiles: new Set<string>(),
    watcher: null as FSWatcher | null,
    activeChild: null as ChildProcess | null,
  }

  // Build file → project lookup for re-runs
  const fileToProject = new Map<string, ResolvedProject>()
  if (ctx.projects) {
    for (const project of ctx.projects) {
      for (const file of project.testFiles) {
        fileToProject.set(file, project)
      }
    }
  }

  const serializedConfig: SerializedConfig = {
    timeout: ctx.config.timeout,
    retries: ctx.config.retries,
    screenshot: ctx.config.screenshot,
    rootDir: ctx.config.rootDir,
    outputDir: ctx.config.outputDir,
    apk: ctx.config.apk,
    activity: ctx.config.activity,
    package: ctx.config.package,
    agentApk: ctx.config.agentApk,
    agentTestApk: ctx.config.agentTestApk,
    trace: typeof ctx.config.trace === 'string' || typeof ctx.config.trace === 'object'
      ? ctx.config.trace
      : undefined,
  }

  // Resolve tsx binary for forking TypeScript files
  const jsScript = path.resolve(__dirname, 'watch-run.js')
  const tsScript = path.resolve(__dirname, 'watch-run.ts')
  const useTypeScript = !fs.existsSync(jsScript) && fs.existsSync(tsScript)
  const resolvedScript = useTypeScript ? tsScript : jsScript

  let tsxBin: string | undefined
  if (useTypeScript) {
    const pilotPkgDir = path.resolve(__dirname, '..')
    const localTsx = path.join(pilotPkgDir, 'node_modules', '.bin', 'tsx')
    tsxBin = fs.existsSync(localTsx) ? localTsx : 'tsx'
  }

  // ─── Run execution ───

  /** Run files respecting project wave ordering (used for initial run and run-all). */
  async function executeWaveRun(): Promise<void> {
    state.isRunning = true
    state.lastRunFiles = [...state.knownFiles]

    if (!state.isInitialRun) {
      process.stdout.write('\x1b[2J\x1b[H') // clear visible area, cursor to top
    }

    const runStart = Date.now()
    const allResults: TestResult[] = []
    const allSuites: SuiteResult[] = []

    const reporters = await createReporters(ctx.config.reporter)
    const reporter = new ReporterDispatcher(reporters)

    const totalFiles = [...state.knownFiles].length
    reporter.onRunStart(ctx.config, totalFiles)

    if (ctx.projectWaves && ctx.projects) {
      // Wave-based execution respecting project dependencies
      const failedProjects = new Set<string>()

      for (const wave of ctx.projectWaves) {
        for (const project of wave) {
          // Skip projects whose dependencies failed
          const blockedBy = project.dependencies.find((d) => failedProjects.has(d))
          if (blockedBy) {
            process.stdout.write(`${DIM}Skipping project "${project.name}" — dependency "${blockedBy}" failed${RESET}\n`)
            for (const file of project.testFiles) {
              const skippedResult: TestResult = {
                name: path.basename(file),
                fullName: path.basename(file),
                status: 'skipped',
                durationMs: 0,
                project: project.name,
              }
              allResults.push(skippedResult)
              reporter.onTestEnd?.(skippedResult)
            }
            failedProjects.add(project.name)
            continue
          }

          let projectFailed = false

          for (const file of project.testFiles) {
            reporter.onTestFileStart?.(file)

            try {
              const { results, suite } = await runFileInChild(
                file,
                reporter,
                project.use as RunFileUseOptions | undefined,
                project.name !== 'default' ? project.name : undefined,
              )
              allResults.push(...results)
              allSuites.push(suite)
              reporter.onTestFileEnd?.(file, results)

              if (results.some((r) => r.status === 'failed')) {
                state.failedFiles.add(file)
                projectFailed = true
              } else {
                state.failedFiles.delete(file)
              }
            } catch (err) {
              const errorResult = makeErrorResult(file, err, project.name)
              allResults.push(errorResult)
              reporter.onTestEnd?.(errorResult)
              reporter.onTestFileEnd?.(file, [errorResult])
              state.failedFiles.add(file)
              projectFailed = true
            }
          }

          if (projectFailed) {
            failedProjects.add(project.name)
          }
        }
      }
    } else {
      // No projects — run files sequentially
      for (const file of state.knownFiles) {
        reporter.onTestFileStart?.(file)

        try {
          const { results, suite } = await runFileInChild(file, reporter)
          allResults.push(...results)
          allSuites.push(suite)
          reporter.onTestFileEnd?.(file, results)

          if (results.some((r) => r.status === 'failed')) {
            state.failedFiles.add(file)
          } else {
            state.failedFiles.delete(file)
          }
        } catch (err) {
          const errorResult = makeErrorResult(file, err)
          allResults.push(errorResult)
          reporter.onTestEnd?.(errorResult)
          reporter.onTestFileEnd?.(file, [errorResult])
          state.failedFiles.add(file)
        }
      }
    }

    await finishRun(reporter, allResults, allSuites, runStart)
  }

  /** Run specific files (used for file-change re-runs and run-failed). */
  async function executeFileRun(files: string[]): Promise<void> {
    if (files.length === 0) return
    state.isRunning = true
    state.lastRunFiles = files

    process.stdout.write('\x1b[2J\x1b[H') // clear visible area, cursor to top

    const runStart = Date.now()
    const allResults: TestResult[] = []
    const allSuites: SuiteResult[] = []

    const reporters = await createReporters(ctx.config.reporter)
    const reporter = new ReporterDispatcher(reporters)

    reporter.onRunStart(ctx.config, files.length)

    for (const file of files) {
      const project = fileToProject.get(file)
      const useOptions = project?.use as RunFileUseOptions | undefined
      const projectName = project && project.name !== 'default' ? project.name : undefined

      reporter.onTestFileStart?.(file)

      try {
        const { results, suite } = await runFileInChild(file, reporter, useOptions, projectName)
        allResults.push(...results)
        allSuites.push(suite)
        reporter.onTestFileEnd?.(file, results)

        if (results.some((r) => r.status === 'failed')) {
          state.failedFiles.add(file)
        } else {
          state.failedFiles.delete(file)
        }
      } catch (err) {
        const errorResult = makeErrorResult(file, err, projectName)
        allResults.push(errorResult)
        reporter.onTestEnd?.(errorResult)
        reporter.onTestFileEnd?.(file, [errorResult])
        state.failedFiles.add(file)
      }
    }

    await finishRun(reporter, allResults, allSuites, runStart)
  }

  async function finishRun(
    reporter: ReporterDispatcher,
    allResults: TestResult[],
    allSuites: SuiteResult[],
    runStart: number,
  ): Promise<void> {
    const totalDuration = Date.now() - runStart
    const fullResult: FullResult = {
      status: allResults.some((r) => r.status === 'failed') ? 'failed' : 'passed',
      duration: totalDuration,
      tests: allResults,
      suites: allSuites,
    }

    await reporter.onRunEnd(fullResult)
    printStatusLine(allResults, totalDuration)

    state.isRunning = false
    state.isInitialRun = false

    // Process any queued runs
    if (state.pendingFiles) {
      const next = state.pendingFiles === 'all' ? null : [...state.pendingFiles]
      state.pendingFiles = null
      if (next) {
        await executeFileRun(next)
      } else {
        await executeWaveRun()
      }
    }
  }

  function makeErrorResult(file: string, err: unknown, projectName?: string): TestResult {
    return {
      name: path.basename(file),
      fullName: path.basename(file),
      status: 'failed',
      durationMs: 0,
      error: err instanceof Error ? err : new Error(String(err)),
      project: projectName,
    }
  }

  function runFileInChild(
    filePath: string,
    reporter: PilotReporter,
    projectUseOptions?: RunFileUseOptions,
    projectName?: string,
  ): Promise<{ results: TestResult[]; suite: SuiteResult }> {
    return new Promise((resolve, reject) => {
      const child = fork(resolvedScript, [], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        ...(tsxBin ? { execPath: tsxBin } : {}),
        env: {
          ...process.env,
          NODE_PATH: path.resolve(__dirname, '..', '..'),
        },
      })

      state.activeChild = child
      let settled = false

      const msg: WatchRunMessage = {
        type: 'run',
        daemonAddress: ctx.daemonAddress,
        deviceSerial: ctx.deviceSerial,
        filePath,
        config: serializedConfig,
        screenshotDir: ctx.screenshotDir,
        projectUseOptions,
        projectName,
      }

      child.on('message', (response: WatchRunChildMessage) => {
        if (settled) return

        switch (response.type) {
          case 'test-end': {
            // Forward to reporter for live output
            const result = deserializeTestResult(response.result)
            reporter.onTestEnd?.(result)
            break
          }
          case 'file-done': {
            settled = true
            const results = response.results.map(deserializeTestResult)
            const suite = deserializeSuiteResult(response.suite)
            resolve({ results, suite })
            break
          }
          case 'error':
            settled = true
            reject(new Error(response.error.message))
            break
        }
      })

      child.on('exit', (code) => {
        state.activeChild = null
        if (!settled) {
          settled = true
          reject(new Error(`Watch worker exited with code ${code ?? 0} without sending results`))
        }
      })

      child.on('error', (err) => {
        state.activeChild = null
        if (!settled) {
          settled = true
          reject(err)
        }
      })

      child.send(msg)
    })
  }

  // ─── File watching ───
  // Chokidar v4 does NOT support glob patterns — only actual file/directory
  // paths. So we watch the discovered test files directly for changes, and
  // watch the root directory for new file detection.

  function startWatcher(): FSWatcher {
    // Watch the actual discovered test files (not globs)
    const filesToWatch = [...state.knownFiles]

    // Also watch the config file for change notification
    const configCandidates = ['pilot.config.ts', 'pilot.config.js', 'pilot.config.mjs']
    const configPath = configCandidates
      .map((name) => path.resolve(ctx.config.rootDir, name))
      .find((p) => fs.existsSync(p))
    if (configPath) {
      filesToWatch.push(configPath)
    }

    const watcher = chokidarWatch(filesToWatch, { ignoreInitial: true })

    watcher.on('change', (filePath) => {
      if (configPath && filePath === configPath) {
        process.stdout.write(
          `\n${YELLOW}Config file changed. Restart watch mode to pick up changes.${RESET}\n`,
        )
        printStatusLine()
        return
      }
      if (state.knownFiles.has(filePath)) {
        scheduleFileRun([filePath])
      }
    })

    watcher.on('unlink', (filePath) => {
      state.knownFiles.delete(filePath)
      state.failedFiles.delete(filePath)
    })

    return watcher
  }

  // ─── Debounce + queue ───

  function scheduleFileRun(files: string[]): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    if (state.isRunning) {
      if (state.pendingFiles === 'all') return
      if (state.pendingFiles) {
        for (const f of files) state.pendingFiles.add(f)
      } else {
        state.pendingFiles = new Set(files)
      }
      return
    }

    // Accumulate files across rapid-fire debounce calls
    for (const f of files) state.debounceFiles.add(f)

    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null
      const batch = [...state.debounceFiles]
      state.debounceFiles.clear()
      executeFileRun(batch).catch((err) => {
        process.stderr.write(`${RED}Watch run error: ${err instanceof Error ? err.message : err}${RESET}\n`)
        state.isRunning = false
      })
    }, 300)
  }

  function scheduleRunAll(): void {
    if (state.isRunning) {
      state.pendingFiles = 'all'
      return
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }

    executeWaveRun().catch((err) => {
      process.stderr.write(`${RED}Watch run error: ${err instanceof Error ? err.message : err}${RESET}\n`)
      state.isRunning = false
    })
  }

  function scheduleRunFailed(): void {
    const failedList = [...state.failedFiles].filter((f) => state.knownFiles.has(f))
    if (failedList.length === 0) {
      process.stdout.write(`${DIM}No failed tests to re-run.${RESET}\n`)
      return
    }

    if (state.isRunning) {
      state.pendingFiles = new Set(failedList)
      return
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }

    executeFileRun(failedList).catch((err) => {
      process.stderr.write(`${RED}Watch run error: ${err instanceof Error ? err.message : err}${RESET}\n`)
      state.isRunning = false
    })
  }

  function scheduleRerun(): void {
    if (state.lastRunFiles.length === 0) return
    const validFiles = state.lastRunFiles.filter((f) => state.knownFiles.has(f))
    if (validFiles.length === 0) return

    if (state.isRunning) {
      state.pendingFiles = new Set(validFiles)
      return
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }

    executeFileRun(validFiles).catch((err) => {
      process.stderr.write(`${RED}Watch run error: ${err instanceof Error ? err.message : err}${RESET}\n`)
      state.isRunning = false
    })
  }

  // ─── Keyboard input ───

  function setupKeyboardInput(): void {
    if (!process.stdin.isTTY) return

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    process.stdin.on('data', (key: string) => {
      switch (key) {
        case 'a':
          scheduleRunAll()
          break
        case 'f':
          scheduleRunFailed()
          break
        case '\r': // Enter
        case '\n':
          scheduleRerun()
          break
        case 'q':
        case '\x03': // Ctrl+C
          cleanup()
          break
      }
    })
  }

  // ─── Status line ───

  function printStatusLine(results?: TestResult[], durationMs?: number): void {
    process.stdout.write('\n')

    if (results && durationMs !== undefined) {
      const passed = results.filter((r) => r.status === 'passed').length
      const failed = results.filter((r) => r.status === 'failed').length
      const skipped = results.filter((r) => r.status === 'skipped').length
      const duration = (durationMs / 1000).toFixed(1)
      const parts: string[] = []
      if (passed > 0) parts.push(`${GREEN}${passed} passed${RESET}`)
      if (failed > 0) parts.push(`${RED}${failed} failed${RESET}`)
      if (skipped > 0) parts.push(`${DIM}${skipped} skipped${RESET}`)
      process.stdout.write(`  ${parts.join(', ')} ${DIM}(${duration}s)${RESET}\n\n`)
    }

    process.stdout.write(`${BOLD}Watch Usage${RESET}\n`)
    process.stdout.write(`${DIM} ${CYAN}\u203a${RESET}${DIM} Press ${BOLD}a${RESET}${DIM} to run all tests${RESET}\n`)
    process.stdout.write(`${DIM} ${CYAN}\u203a${RESET}${DIM} Press ${BOLD}f${RESET}${DIM} to run only failed tests${RESET}\n`)
    if (state.lastRunFiles.length > 0) {
      const fileNames = state.lastRunFiles.map((f) => path.basename(f)).join(', ')
      process.stdout.write(`${DIM} ${CYAN}\u203a${RESET}${DIM} Press ${BOLD}Enter${RESET}${DIM} to re-run ${fileNames}${RESET}\n`)
    }
    process.stdout.write(`${DIM} ${CYAN}\u203a${RESET}${DIM} Press ${BOLD}q${RESET}${DIM} to quit${RESET}\n`)
  }

  // ─── Cleanup ───

  function cleanup(): void {
    if (state.activeChild) {
      try { state.activeChild.kill() } catch { /* already dead */ }
    }

    if (state.watcher) {
      state.watcher.close()
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }

    ctx.device.close()
    ctx.client.close()

    preserveEmulatorsForReuse(ctx.launchedEmulators)

    process.exit(0)
  }

  // ─── Start watch mode ───

  process.stdout.write(`${BOLD}Watch mode started.${RESET} Watching ${state.knownFiles.size} test file(s).\n`)
  process.stdout.write(`${DIM}Using device: ${ctx.deviceSerial}${RESET}\n\n`)

  state.watcher = startWatcher()

  setupKeyboardInput()

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Run initial test suite
  await executeWaveRun()

  // Keep alive forever — cleaned up via `cleanup()` on quit/signal.
  await new Promise<void>(() => { /* never resolves */ })
}

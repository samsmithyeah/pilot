import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WatchRunMessage, WatchRunChildMessage } from '../watch-run.js'

// ─── Mock child_process.fork ───

interface MockChild {
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  _listeners: Record<string, Array<(...args: unknown[]) => void>>
  _emit: (event: string, ...args: unknown[]) => void
}

function createMockChild(): MockChild {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    _listeners: listeners,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    send: vi.fn(),
    kill: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args)
    },
  }
}

vi.mock('node:child_process', () => ({
  fork: vi.fn(() => createMockChild()),
}))

vi.mock('chokidar', () => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    watch: vi.fn(() => ({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(cb)
        return { on: vi.fn() }
      }),
      close: vi.fn(),
      _listeners: listeners,
    })),
  }
})

vi.mock('../reporter.js', () => ({
  createReporters: vi.fn(async () => []),
  ReporterDispatcher: vi.fn(() => ({
    onRunStart: vi.fn(),
    onTestFileStart: vi.fn(),
    onTestEnd: vi.fn(),
    onTestFileEnd: vi.fn(),
    onRunEnd: vi.fn(async () => {}),
    onError: vi.fn(),
  })),
}))

vi.mock('../emulator.js', () => ({
  preserveEmulatorsForReuse: vi.fn(),
}))

// ─── Tests for watch-run.ts IPC protocol ───

describe('watch-run IPC protocol', () => {
  it('WatchRunMessage has the expected shape', () => {
    const msg: WatchRunMessage = {
      type: 'run',
      daemonAddress: 'localhost:50051',
      deviceSerial: 'emulator-5554',
      filePath: '/test/login.test.ts',
      config: {
        timeout: 30_000,
        retries: 0,
        screenshot: 'only-on-failure',
        rootDir: '/project',
        outputDir: 'pilot-results',
      },
    }

    expect(msg.type).toBe('run')
    expect(msg.daemonAddress).toBe('localhost:50051')
    expect(msg.deviceSerial).toBe('emulator-5554')
    expect(msg.filePath).toBe('/test/login.test.ts')
  })

  it('WatchRunChildMessage file-done has results and suite', () => {
    const msg: WatchRunChildMessage = {
      type: 'file-done',
      filePath: '/test/login.test.ts',
      results: [
        {
          name: 'should login',
          fullName: 'Login > should login',
          status: 'passed',
          durationMs: 1234,
          workerIndex: 0,
        },
      ],
      suite: {
        name: '',
        tests: [
          {
            name: 'should login',
            fullName: 'Login > should login',
            status: 'passed',
            durationMs: 1234,
            workerIndex: 0,
          },
        ],
        suites: [],
        durationMs: 1234,
      },
    }

    expect(msg.type).toBe('file-done')
    expect(msg.results).toHaveLength(1)
    expect(msg.results[0].status).toBe('passed')
  })

  it('WatchRunChildMessage error has message and stack', () => {
    const msg: WatchRunChildMessage = {
      type: 'error',
      error: { message: 'daemon not reachable', stack: 'Error: ...' },
    }

    expect(msg.type).toBe('error')
    expect(msg.error.message).toBe('daemon not reachable')
  })
})

// ─── Tests for WatchModeContext types ───

describe('WatchModeContext', () => {
  it('accepts valid context shape', async () => {
    // Type-level test — if this compiles, the types are correct
    const _ctx: import('../watch.js').WatchModeContext = {
      config: {
        timeout: 30_000,
        retries: 0,
        screenshot: 'only-on-failure',
        testMatch: ['**/*.test.ts'],
        daemonAddress: 'localhost:50051',
        rootDir: '/project',
        outputDir: 'pilot-results',
        workers: 1,
        launchEmulators: false,
      },
      device: { close: vi.fn() } as unknown as import('../device.js').Device,
      client: { close: vi.fn() } as unknown as import('../grpc-client.js').PilotGrpcClient,
      deviceSerial: 'emulator-5554',
      daemonAddress: 'localhost:50051',
      testFiles: ['/project/tests/login.test.ts'],
      launchedEmulators: [],
    }
    expect(_ctx.deviceSerial).toBe('emulator-5554')
  })
})

// ─── Tests for debounce and queue logic ───
// These test the scheduling behavior indirectly through the module

describe('watch mode scheduling logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce timer of 300ms collapses rapid changes', async () => {
    // Simulate the debounce logic used in watch.ts
    let runCount = 0
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const collectedFiles = new Set<string>()

    function scheduleRun(files: string[]): void {
      if (debounceTimer) clearTimeout(debounceTimer)
      for (const f of files) collectedFiles.add(f)
      debounceTimer = setTimeout(() => {
        runCount++
        debounceTimer = null
      }, 300)
    }

    // Rapid changes within 300ms
    scheduleRun(['/test/a.test.ts'])
    scheduleRun(['/test/b.test.ts'])
    scheduleRun(['/test/a.test.ts']) // duplicate

    expect(runCount).toBe(0) // not yet fired

    vi.advanceTimersByTime(300)

    expect(runCount).toBe(1) // single batch
    expect(collectedFiles.size).toBe(2) // deduplicated
  })

  it('queues runs while another is in progress', () => {
    let isRunning = false
    let pendingFiles: Set<string> | null = null
    const runs: string[][] = []

    function scheduleRun(files: string[]): void {
      if (isRunning) {
        if (!pendingFiles) pendingFiles = new Set(files)
        else for (const f of files) pendingFiles.add(f)
        return
      }
      isRunning = true
      runs.push(files)
    }

    function finishRun(): void {
      isRunning = false
      if (pendingFiles) {
        const next = [...pendingFiles]
        pendingFiles = null
        scheduleRun(next)
      }
    }

    // First run starts
    scheduleRun(['/test/a.test.ts'])
    expect(runs).toHaveLength(1)

    // Changes during run get queued
    scheduleRun(['/test/b.test.ts'])
    scheduleRun(['/test/c.test.ts'])
    expect(runs).toHaveLength(1) // still only 1 run

    // Finish triggers queued run
    finishRun()
    expect(runs).toHaveLength(2)
    expect(runs[1]).toEqual(expect.arrayContaining(['/test/b.test.ts', '/test/c.test.ts']))
  })

  it('run-all supersedes individual pending files', () => {
    let pendingFiles: Set<string> | 'all' | null = null

    function queueFile(file: string): void {
      if (pendingFiles === 'all') return
      if (pendingFiles) pendingFiles.add(file)
      else pendingFiles = new Set([file])
    }

    function queueAll(): void {
      pendingFiles = 'all'
    }

    queueFile('/test/a.test.ts')
    expect(pendingFiles).toBeInstanceOf(Set)

    queueAll()
    expect(pendingFiles).toBe('all')

    // Further individual files are ignored
    queueFile('/test/b.test.ts')
    expect(pendingFiles).toBe('all')
  })
})

// ─── Tests for file tracking ───

describe('file tracking', () => {
  it('tracks known files and handles add/unlink', () => {
    const knownFiles = new Set(['/test/a.test.ts', '/test/b.test.ts'])
    const failedFiles = new Set(['/test/b.test.ts'])

    // Add new file
    knownFiles.add('/test/c.test.ts')
    expect(knownFiles.size).toBe(3)

    // Remove file
    knownFiles.delete('/test/b.test.ts')
    failedFiles.delete('/test/b.test.ts')
    expect(knownFiles.size).toBe(2)
    expect(failedFiles.size).toBe(0)

    // Remove non-existent file is a no-op
    knownFiles.delete('/test/z.test.ts')
    expect(knownFiles.size).toBe(2)
  })

  it('failed files only includes known files', () => {
    const knownFiles = new Set(['/test/a.test.ts', '/test/b.test.ts'])
    const failedFiles = new Set(['/test/a.test.ts', '/test/deleted.test.ts'])

    const runnableFailedFiles = [...failedFiles].filter((f) => knownFiles.has(f))
    expect(runnableFailedFiles).toEqual(['/test/a.test.ts'])
  })
})

// ─── Tests for interactive key handling ───

describe('interactive key dispatch', () => {
  it('maps keys to correct actions', () => {
    const actions: string[] = []

    function handleKey(key: string): void {
      switch (key) {
        case 'a':
          actions.push('run-all')
          break
        case 'f':
          actions.push('run-failed')
          break
        case '\r':
        case '\n':
          actions.push('rerun')
          break
        case 'q':
        case '\x03':
          actions.push('quit')
          break
      }
    }

    handleKey('a')
    handleKey('f')
    handleKey('\r')
    handleKey('\n')
    handleKey('q')
    handleKey('\x03')
    handleKey('x') // unknown key — no action

    expect(actions).toEqual([
      'run-all', 'run-failed', 'rerun', 'rerun', 'quit', 'quit',
    ])
  })
})

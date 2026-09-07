import { describe, it, expect } from 'vitest';
import { defineConfig, type TapsmithConfig } from '../config.js';
import { projectTreeUse } from '../ui-mode/tree-use.js';

// What the UI-mode test tree badges on a project row: the project's own
// declarations, once. Files, suites and tests under it inherit silently.

function config(overrides: Partial<TapsmithConfig> = {}): TapsmithConfig {
  return defineConfig({ platform: 'android', avd: 'Pixel_6', package: 'com.x', ...overrides });
}

describe('projectTreeUse', () => {
  it('is undefined when the project declares nothing badge-worthy', () => {
    expect(projectTreeUse({ effectiveConfig: config() })).toBeUndefined();
    expect(projectTreeUse({ use: { timeout: 5 } as never, effectiveConfig: config() })).toBeUndefined();
    expect(projectTreeUse({ use: {}, effectiveConfig: config({ devices: 1 }) })).toBeUndefined();
  });

  it('carries the isolation keys and nothing else', () => {
    expect(projectTreeUse({
      use: { appReset: 'restart', appResetScope: 'test', appState: './s.tar.gz', timeout: 5, workers: 2 } as never,
      effectiveConfig: config(),
    })).toEqual({ appReset: 'restart', appResetScope: 'test', appState: './s.tar.gz' });
    // Only a string appState counts (an object form is not a saved-state path).
    expect(projectTreeUse({ use: { appState: { path: 'x' } } as never, effectiveConfig: config() })).toBeUndefined();
  });

  it('names a device group\'s members from the effective config', () => {
    expect(projectTreeUse({
      use: { devices: [{ name: 'alice' }, { name: 'bob' }] } as never,
      effectiveConfig: config({ devices: [{ name: 'alice' }, { name: 'bob', device: 'emulator-5556' }] }),
    })).toEqual({ devices: 2, deviceNames: ['alice', 'bob'] });
    expect(projectTreeUse({ use: {}, effectiveConfig: config({ devices: 3 }) }))
      .toEqual({ devices: 3, deviceNames: ['device-1', 'device-2', 'device-3'] });
  });

  it('combines a group with a reset policy on the same row', () => {
    expect(projectTreeUse({
      use: { appResetScope: 'test' },
      effectiveConfig: config({ devices: 2 }),
    })).toEqual({ appResetScope: 'test', devices: 2, deviceNames: ['device-1', 'device-2'] });
  });
});

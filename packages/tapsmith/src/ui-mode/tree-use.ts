/**
 * What a project declares for the test tree's badges.
 *
 * Project `use` is the base layer under a file's own `test.use()` cascade
 * (runner.ts: `rootCtx.useOptions = { ...projectUse, ...fileUse }`), but the
 * tree shows a declaration where it is made, once — on the project row — and
 * not on every file, suite and test that inherits it. Only the badge-relevant
 * keys travel to the client.
 */

import { deviceGroupNames, deviceGroupSize, type TapsmithConfig } from '../config.js';
import type { TestTreeUseOptions } from './ui-protocol.js';

export interface TreeUseProject {
  use?: { appReset?: unknown; appResetScope?: unknown; appState?: unknown }
  effectiveConfig?: TapsmithConfig
}

export function projectTreeUse(project: TreeUseProject): TestTreeUseOptions | undefined {
  const u = project.use;
  const out: TestTreeUseOptions = {};
  if (u) {
    if (u.appReset !== undefined) out.appReset = u.appReset as TestTreeUseOptions['appReset'];
    if (u.appResetScope !== undefined) out.appResetScope = u.appResetScope as TestTreeUseOptions['appResetScope'];
    if (typeof u.appState === 'string') out.appState = u.appState;
  }
  // A `use.devices` project: every test drives a group — named on the row.
  if (project.effectiveConfig && deviceGroupSize(project.effectiveConfig) > 1) {
    out.devices = deviceGroupSize(project.effectiveConfig);
    const names = deviceGroupNames(project.effectiveConfig);
    if (names) out.deviceNames = names;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

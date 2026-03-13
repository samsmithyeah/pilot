/**
 * Assertion API for Pilot tests.
 *
 * Usage:
 *   expect(device.element(text('Hello'))).toBeVisible();
 *   expect(device.element(role('button', 'Submit'))).not.toBeEnabled();
 */

import type { ElementHandle } from './element-handle.js';
import { selectorToProto } from './selectors.js';

const DEFAULT_ASSERTION_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;

/**
 * Repeatedly call `check` until it returns `true` or the timeout is exceeded.
 */
async function poll(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Final attempt
  return check();
}

function selectorDescription(handle: ElementHandle): string {
  return JSON.stringify(selectorToProto(handle._selector));
}

// ─── Assertion object ───

export interface PilotAssertions {
  /** Negate the following assertion. */
  not: PilotAssertions;

  /** Assert the element is visible on screen. */
  toBeVisible(options?: { timeout?: number }): Promise<void>;

  /** Assert the element is enabled (interactive). */
  toBeEnabled(options?: { timeout?: number }): Promise<void>;

  /** Assert the element's text content matches. */
  toHaveText(expected: string, options?: { timeout?: number }): Promise<void>;

  /** Assert the element exists in the UI hierarchy. */
  toExist(options?: { timeout?: number }): Promise<void>;
}

function createAssertions(handle: ElementHandle, negated: boolean): PilotAssertions {
  const timeoutFor = (opts?: { timeout?: number }) =>
    opts?.timeout ?? handle._timeoutMs ?? DEFAULT_ASSERTION_TIMEOUT_MS;

  const fail = (message: string): never => {
    throw new Error(message);
  };

  const assertions: PilotAssertions = {
    get not(): PilotAssertions {
      return createAssertions(handle, !negated);
    },

    async toBeVisible(options) {
      const timeout = timeoutFor(options);
      const desc = selectorDescription(handle);
      const result = await poll(async () => {
        try {
          const res = await handle._client.findElement(handle._selector, 0);
          return res.found && res.element?.visible === true;
        } catch {
          return false;
        }
      }, timeout);

      if (!negated && !result) {
        fail(`Expected element ${desc} to be visible, but it was not`);
      }
      if (negated && result) {
        fail(`Expected element ${desc} NOT to be visible, but it was`);
      }
    },

    async toBeEnabled(options) {
      const timeout = timeoutFor(options);
      const desc = selectorDescription(handle);
      const result = await poll(async () => {
        try {
          const res = await handle._client.findElement(handle._selector, 0);
          return res.found && res.element?.enabled === true;
        } catch {
          return false;
        }
      }, timeout);

      if (!negated && !result) {
        fail(`Expected element ${desc} to be enabled, but it was not`);
      }
      if (negated && result) {
        fail(`Expected element ${desc} NOT to be enabled, but it was`);
      }
    },

    async toHaveText(expected, options) {
      const timeout = timeoutFor(options);
      const desc = selectorDescription(handle);
      let lastText = '';
      const result = await poll(async () => {
        try {
          const res = await handle._client.findElement(handle._selector, 0);
          if (res.found && res.element) {
            lastText = res.element.text;
            return res.element.text === expected;
          }
          return false;
        } catch {
          return false;
        }
      }, timeout);

      if (!negated && !result) {
        fail(
          `Expected element ${desc} to have text "${expected}", but got "${lastText}"`,
        );
      }
      if (negated && result) {
        fail(
          `Expected element ${desc} NOT to have text "${expected}", but it did`,
        );
      }
    },

    async toExist(options) {
      const timeout = timeoutFor(options);
      const desc = selectorDescription(handle);
      const result = await poll(async () => {
        try {
          const res = await handle._client.findElement(handle._selector, 0);
          return res.found;
        } catch {
          return false;
        }
      }, timeout);

      if (!negated && !result) {
        fail(`Expected element ${desc} to exist, but it did not`);
      }
      if (negated && result) {
        fail(`Expected element ${desc} NOT to exist, but it did`);
      }
    },
  };

  return assertions;
}

/**
 * Create assertions for an ElementHandle.
 */
export function expect(handle: ElementHandle): PilotAssertions {
  return createAssertions(handle, false);
}

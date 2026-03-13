/**
 * ElementHandle — a lazy reference to a UI element found by a Selector.
 *
 * Returned by `device.element(selector)`. Supports chaining with `.element()`
 * and all the same actions as Device (tap, type, …). Also serves as the
 * assertion target for `expect()`.
 */

import { type Selector, selectorToProto } from './selectors.js';
import type { PilotGrpcClient, ElementInfo } from './grpc-client.js';

export class ElementHandle {
  /** @internal */
  readonly _client: PilotGrpcClient;
  /** @internal */
  readonly _selector: Selector;
  /** @internal */
  readonly _timeoutMs: number;

  constructor(client: PilotGrpcClient, selector: Selector, timeoutMs: number) {
    this._client = client;
    this._selector = selector;
    this._timeoutMs = timeoutMs;
  }

  /**
   * Scope a child selector within this element.
   */
  element(childSelector: Selector): ElementHandle {
    const scoped = childSelector.within(this._selector);
    return new ElementHandle(this._client, scoped, this._timeoutMs);
  }

  // ── Queries ──

  /** Resolve this handle to an ElementInfo. Throws if not found within timeout. */
  async find(): Promise<ElementInfo> {
    const res = await this._client.findElement(this._selector, this._timeoutMs);
    if (!res.found || !res.element) {
      throw new Error(
        res.errorMessage ||
          `Element not found: ${JSON.stringify(selectorToProto(this._selector))}`,
      );
    }
    return res.element;
  }

  /** Returns true if the element exists in the current UI. */
  async exists(): Promise<boolean> {
    const res = await this._client.findElement(this._selector, this._timeoutMs);
    return res.found;
  }

  // ── Actions ──

  async tap(): Promise<void> {
    const res = await this._client.tap(this._selector, this._timeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Tap failed');
    }
  }

  async longPress(durationMs?: number): Promise<void> {
    const res = await this._client.longPress(this._selector, durationMs, this._timeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Long press failed');
    }
  }

  async type(text: string): Promise<void> {
    const res = await this._client.typeText(this._selector, text, this._timeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Type text failed');
    }
  }

  async clearAndType(text: string): Promise<void> {
    const res = await this._client.clearAndType(this._selector, text, this._timeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Clear and type failed');
    }
  }

  async clear(): Promise<void> {
    const res = await this._client.clearText(this._selector, this._timeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Clear text failed');
    }
  }

  async scroll(direction: string, options?: { distance?: number }): Promise<void> {
    const res = await this._client.scroll(this._selector, direction, {
      distance: options?.distance,
      timeoutMs: this._timeoutMs,
    });
    if (!res.success) {
      throw new Error(res.errorMessage || 'Scroll failed');
    }
  }

  // ── Info accessors (convenience) ──

  async getText(): Promise<string> {
    const info = await this.find();
    return info.text;
  }

  async isVisible(): Promise<boolean> {
    const info = await this.find();
    return info.visible;
  }

  async isEnabled(): Promise<boolean> {
    const info = await this.find();
    return info.enabled;
  }
}

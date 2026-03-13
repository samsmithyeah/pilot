/**
 * Device — the primary user-facing API for interacting with a mobile device.
 *
 * All methods accept a Selector and delegate to the Rust daemon via gRPC.
 * Auto-waiting is handled daemon-side; the SDK just passes the configured
 * timeout.
 */

import type { Selector } from './selectors.js';
import { PilotGrpcClient, type SwipeOptions, type ScrollOptions, type ScreenshotResponse } from './grpc-client.js';
import { ElementHandle } from './element-handle.js';
import type { PilotConfig } from './config.js';

export class Device {
  /** @internal */
  readonly _client: PilotGrpcClient;
  private readonly defaultTimeoutMs: number;

  constructor(client: PilotGrpcClient, config?: Pick<PilotConfig, 'timeout'>) {
    this._client = client;
    this.defaultTimeoutMs = config?.timeout ?? 30_000;
  }

  // ── Element handle ──

  /**
   * Returns an ElementHandle for the given selector. The element is not
   * resolved immediately — it is looked up lazily when an action or assertion
   * is performed.
   */
  element(selector: Selector): ElementHandle {
    return new ElementHandle(this._client, selector, this.defaultTimeoutMs);
  }

  // ── Actions ──

  async tap(selector: Selector): Promise<void> {
    const res = await this._client.tap(selector, this.defaultTimeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Tap failed');
    }
  }

  async longPress(selector: Selector, durationMs?: number): Promise<void> {
    const res = await this._client.longPress(selector, durationMs, this.defaultTimeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Long press failed');
    }
  }

  async type(selector: Selector, text: string): Promise<void> {
    const res = await this._client.typeText(selector, text, this.defaultTimeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Type text failed');
    }
  }

  async clearAndType(selector: Selector, text: string): Promise<void> {
    const res = await this._client.clearAndType(selector, text, this.defaultTimeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Clear and type failed');
    }
  }

  async swipe(direction: string, options?: SwipeOptions): Promise<void> {
    const res = await this._client.swipe(direction, {
      ...options,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
    });
    if (!res.success) {
      throw new Error(res.errorMessage || 'Swipe failed');
    }
  }

  async scroll(selector: Selector, direction: string, options?: ScrollOptions): Promise<void> {
    const res = await this._client.scroll(selector, direction, {
      ...options,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
    });
    if (!res.success) {
      throw new Error(res.errorMessage || 'Scroll failed');
    }
  }

  async pressKey(key: string): Promise<void> {
    const res = await this._client.pressKey(key);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Press key failed');
    }
  }

  async pressBack(): Promise<void> {
    return this.pressKey('BACK');
  }

  // ── Utilities ──

  async takeScreenshot(): Promise<ScreenshotResponse> {
    return this._client.takeScreenshot();
  }

  async waitForIdle(timeoutMs?: number): Promise<void> {
    const res = await this._client.waitForIdle(timeoutMs ?? this.defaultTimeoutMs);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Wait for idle timed out');
    }
  }

  async installApk(apkPath: string): Promise<void> {
    const res = await this._client.installApk(apkPath);
    if (!res.success) {
      throw new Error(res.errorMessage || 'APK install failed');
    }
  }

  async listDevices() {
    return this._client.listDevices();
  }

  async setDevice(serial: string): Promise<void> {
    const res = await this._client.setDevice(serial);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Set device failed');
    }
  }

  async startAgent(targetPackage: string): Promise<void> {
    const res = await this._client.startAgent(targetPackage);
    if (!res.success) {
      throw new Error(res.errorMessage || 'Start agent failed');
    }
  }

  close(): void {
    this._client.close();
  }
}

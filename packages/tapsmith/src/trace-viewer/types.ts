/**
 * Trace-viewer-local types.
 *
 * Types that are consumed by trace-viewer components but conceptually live
 * outside the core trace data model (which is in `../trace/types.ts`).
 * Keeping them here means trace-viewer doesn't need to reach up into ui-mode
 * for types it owns the rendering of.
 */

/**
 * In-flight action/assertion currently being executed by the device.
 * Consumed by ActionsPanel to render the in-progress row with a spinner.
 *
 * Sourced from a `lifecycle: 'started'` trace-event in UI mode; the static
 * trace-viewer (.zip archives) leaves this unset.
 */
export interface InFlightAction {
  actionIndex: number
  kind: 'action' | 'assertion'
  /** Display label, e.g. "tap" or "toBeVisible". */
  label: string
  /** Serialized selector JSON (action) or selector string (assertion). */
  selector?: string
  /** Whether the action failed — assertions only set this on the started
   * event for visual parity; for live in-flight items it's always false. */
  failed: boolean
  startedAt: number
  /** Element bounds at action start, for the screenshot overlay. */
  bounds?: { left: number; top: number; right: number; bottom: number }
  /** Tap/swipe target point, for the screenshot overlay. */
  point?: { x: number; y: number }
}

import { beforeEach, contentDesc, describe, expect, id, test, text } from "pilot"
import { GesturesScreen } from "../screens/gestures.screen.js"
import { resetTestApp } from "../support/reset-app.js"

describe("iOS gestures fast loop", () => {
  beforeEach(async ({ device }) => {
    await resetTestApp(device)
    await device.tap(contentDesc("Gestures"))
    await expect(device.element(text("Gesture Testing"))).toBeVisible()
  })

  test("can drag element to drop zone", async ({ device }) => {
    const screen = new GesturesScreen(device)
    await device.drag({
      from: id("draggable"),
      to: id("drop-zone"),
    })
    await expect(screen.lastGesture).toHaveText("Last gesture: Drag")
  })

  test("pinchIn gesture on pinch area", async ({ device }) => {
    await device.pinchIn(id("pinch-area"), { scale: 0.5 })
  })

  test("pinchOut gesture on pinch area", async ({ device }) => {
    await device.pinchOut(id("pinch-area"), { scale: 2.0 })
  })
})

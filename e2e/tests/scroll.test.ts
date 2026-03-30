import { beforeEach, describe, expect, test, text } from "pilot"
import { ScrollScreen } from "../screens/scroll.screen.js"
import { openTestScreen } from "../support/open-test-screen.js"

describe("Scroll screen", () => {
  beforeEach(async ({ device }) => {
    await openTestScreen(device, "scroll", "Scroll Testing")
  })

  test("shows heading and description", async ({ device }) => {
    const screen = new ScrollScreen(device)
    await expect(screen.heading).toBeVisible()
  })

  test("first section is visible", async ({ device }) => {
    const screen = new ScrollScreen(device)
    await expect(screen.sectionA).toBeVisible()
    await expect(screen.firstItem).toBeVisible()
  })

  test("first item label is visible", async ({ device }) => {
    await expect(device.element(text("Item A-1"))).toBeVisible()
  })

  // ─── Element Screenshots ───

  test("can take element screenshot", async ({ device }) => {
    const screen = new ScrollScreen(device)
    const png = await screen.sectionA.screenshot()
    expect(png.length).toBeGreaterThan(0)
  })

  test("can take full device screenshot", async ({ device }) => {
    const screenshot = await device.takeScreenshot()
    expect(screenshot.success).toBe(true)
    expect(screenshot.data.length).toBeGreaterThan(0)
  })
})

import { beforeEach, describe, expect, id, test, text } from "pilot"
import { VisibilityScreen } from "../screens/visibility.screen.js"
import { openTestScreen } from "../support/open-test-screen.js"

describe("Visibility screen", () => {
  beforeEach(async ({ device }) => {
    await openTestScreen(device, "visibility", "Visibility Testing")
  })

  // ─── Dismissable Banner ───

  test("banner is visible on load", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await expect(screen.banner).toBeVisible()
    await expect(screen.banner).toExist()
  })

  test("dismissing banner hides it", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.dismissBannerButton.tap()
    await expect(screen.banner).not.toBeVisible()
  })

  test("show banner button restores it", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.dismissBannerButton.tap()
    await expect(screen.banner).not.toBeVisible()
    await screen.showBannerButton.tap()
    await expect(screen.banner).toBeVisible()
  })

  // ─── Expandable Section ───

  test("expand toggle is visible", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await expect(screen.expandToggle).toBeVisible()
  })

  test("expanded content does not exist by default", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await expect(screen.expandedContent).not.toExist()
  })

  test("expanding reveals content", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.expandToggle.tap()
    await expect(screen.expandedContent).toBeVisible()
  })

  test("collapsing hides content", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.expandToggle.tap()
    await expect(screen.expandedContent).toBeVisible()
    await screen.expandToggle.tap()
    await expect(screen.expandedContent).not.toExist()
  })

  // ─── Dynamic List ───

  test("dynamic list shows 3 items initially", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await expect(screen.itemCount(3)).toBeVisible()
  })

  test("adding an item increases the count", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.addItemButton.tap()
    await expect(screen.itemCount(4)).toBeVisible()
  })

  test("deleting an item decreases the count", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.addItemButton.tap()
    await expect(screen.itemCount(4)).toBeVisible()
    await screen.deleteItem("Item A").tap()
    await expect(screen.itemCount(3)).toBeVisible()
  })

  // ─── Loading State ───

  test("content loaded is shown initially", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await expect(screen.contentLoaded).toBeVisible()
  })

  test("loading indicator appears and then disappears", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.startLoadingButton.scrollIntoView()
    await screen.startLoadingButton.tap()
    await expect(screen.loadingIndicator).toBeVisible()
    await expect(screen.contentLoaded).toBeVisible({ timeout: 5000 })
  })

  // ─── Error State ───

  test("triggering error shows the error message", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.toggleErrorButton.scrollIntoView()
    await screen.toggleErrorButton.tap()
    await expect(screen.errorText).toExist()
  })

  test("clearing error hides the message", async ({ device }) => {
    const screen = new VisibilityScreen(device)
    await screen.toggleErrorButton.scrollIntoView()
    await screen.toggleErrorButton.tap()
    await expect(screen.errorMessage).not.toBeVisible()
  })
})

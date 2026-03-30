import { beforeEach, contentDesc, describe, expect, test, text } from "pilot"
import { DialogsScreen } from "../screens/dialogs.screen.js"
import { resetTestApp } from "../support/reset-app.js"

describe("Dialogs screen", () => {
  // Restart app before each test to ensure clean state. Transient UI
  // elements like toasts can leak between tests under heavy load.
  beforeEach(async ({ device }) => {
    await resetTestApp(device)
    const dialogsCard = device.element(contentDesc("Dialogs"))
    await dialogsCard.scrollIntoView()
    await dialogsCard.tap()
    await expect(device.element(text("Dialogs & Overlays"))).toBeVisible()
  })

  // ─── Toast ───

  test("tapping show toast displays a toast", async ({ device }) => {
    const screen = new DialogsScreen(device)
    await screen.showToastButton.tap()
    await expect(screen.toastSuccess).toBeVisible()
  })

  test("error toast shows error message", async ({ device }) => {
    const screen = new DialogsScreen(device)
    await screen.showErrorToastButton.tap()
    await expect(screen.toastError).toBeVisible()
  })

  // ─── Snackbar ───

  test("can show and dismiss snackbar", async ({ device }) => {
    const screen = new DialogsScreen(device)
    await screen.showSnackbarButton.tap()
    await expect(screen.snackbarMessage).toBeVisible()
    await expect(screen.snackbarDismiss).toBeVisible()

    await screen.snackbarDismiss.tap()
    await expect(screen.snackbar).not.toBeVisible()
  })

  // ─── Modal ───

  test("can show and cancel modal", async ({ device }) => {
    const screen = new DialogsScreen(device)
    await screen.showModalButton.tap()
    await expect(screen.modalTitle).toBeVisible()
    await expect(screen.cancelButton).toBeVisible()
    await expect(screen.confirmButton).toBeVisible()

    await screen.cancelButton.tap()
    await expect(screen.modal).not.toBeVisible()
  })
})

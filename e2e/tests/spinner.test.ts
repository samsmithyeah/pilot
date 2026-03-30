import { beforeEach, describe, expect, id, test, text } from "pilot"
import { SpinnerScreen } from "../screens/spinner.screen.js"
import { resetTestApp } from "../support/reset-app.js"

describe("Spinner screen", () => {
  beforeEach(async ({ device }) => {
    await resetTestApp(device)
    const spinnerCard = device.element(id("home-card-spinner"))
    await spinnerCard.scrollIntoView()
    await spinnerCard.tap()
    await expect(device.element(text("Dropdowns"))).toBeVisible()
  })

  // ─── Dropdowns ───

  test("shows dropdown heading", async ({ device }) => {
    const screen = new SpinnerScreen(device)
    await expect(screen.heading).toBeVisible()
  })

  test("country dropdown is unselected initially", async ({ device }) => {
    const screen = new SpinnerScreen(device)
    await expect(screen.countryDropdown).toBeVisible()
    await expect(screen.placeholder).toBeVisible()
  })

  test("tapping country dropdown opens options and allows selection", async ({ device }) => {
    const screen = new SpinnerScreen(device)
    await screen.countryDropdown.tap()
    await expect(screen.option("United States")).toBeVisible()
    await expect(screen.option("United Kingdom")).toBeVisible()
    await screen.option("Canada").tap()
    await expect(screen.selectedCountry).toHaveText("Country: Canada")
  })

  test("can select a color", async ({ device }) => {
    const screen = new SpinnerScreen(device)
    await screen.colorDropdown.tap()
    await screen.option("Blue").tap()
    await expect(screen.selectedColor).toHaveText("Color: Blue")
  })

  test("can select a priority", async ({ device }) => {
    const screen = new SpinnerScreen(device)
    await screen.priorityDropdown.tap()
    await screen.option("High").tap()
    await expect(screen.selectedPriority).toHaveText("Priority: High")
  })
})

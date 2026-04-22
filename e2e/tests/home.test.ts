import { describe, expect, test } from "tapsmith"
import { HomeScreen } from "../screens/home.screen.js"

describe("Home screen", () => {
  test("shows the app header", async ({ device }) => {
    const home = new HomeScreen(device)
    await expect(home.header).toBeVisible()
  })

  test("displays navigation cards", async ({ device }) => {
    const home = new HomeScreen(device)
    await expect(home.loginCard).toBeVisible()
    await expect(home.listCard).toBeVisible()
    await expect(home.togglesCard).toBeVisible()
    await expect(home.spinnerCard).toBeVisible()
    await expect(home.gesturesCard).toBeVisible()
    await expect(home.dialogsCard).toBeVisible()
  })

  test("cards have accessible labels", async ({ device }) => {
    const home = new HomeScreen(device)
    await expect(home.loginCard).toHaveText("Login Form")
    await expect(home.listCard).toHaveText("List")
  })

  test("header element exists and has text", async ({ device }) => {
    const home = new HomeScreen(device)
    await expect(home.header).toExist()
    await expect(home.header).toHaveText("Test Screens")
  })

  test("can scroll to see more cards", async ({ device }) => {
    const home = new HomeScreen(device)
    await home.scrollCard.scrollIntoView()
    await expect(home.slowLoadCard).toBeVisible()
    await expect(home.scrollCard).toBeVisible()
  })
})

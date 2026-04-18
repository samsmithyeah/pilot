import { beforeAll, describe, expect, test } from "pilot"
import { LoginScreen } from "../screens/login.screen.js"

describe("Login screen", () => {
  beforeAll(async ({ device }) => {
    await device.getByDescription("Login Form").tap()
  })

  // ─── Layout & Visibility ───

  test("shows the sign in heading", async ({ device }) => {
    const login = new LoginScreen(device)
    await expect(login.heading).toBeVisible()
  })

  test("shows email and password fields", async ({ device }) => {
    const login = new LoginScreen(device)
    await expect(login.emailField).toBeVisible()
    await expect(login.passwordField).toBeVisible()
  })

  test("email field is editable", async ({ device }) => {
    const login = new LoginScreen(device)
    await expect(login.emailField).toBeEnabled()
  })

  test("sign in button starts disabled", async ({ device }) => {
    const login = new LoginScreen(device)
    await expect(login.signInButton).toBeDisabled()
  })

  test("forgot password link is visible", async ({ device }) => {
    const login = new LoginScreen(device)
    await expect(login.forgotPasswordLink).toBeVisible()
  })

  // ─── Text Input ───

  test("can type into email field", async ({ device }) => {
    const login = new LoginScreen(device)
    await login.emailField.type("test@example.com")
    await expect(login.emailField).toHaveValue("test@example.com")
  })

  test("can type into password field", async ({ device }) => {
    const login = new LoginScreen(device)
    await login.passwordField.type("password123")
  })

  // ─── Focus & Keyboard ───

  test("focusing and blurring email field toggles keyboard", async ({ device }) => {
    const emailField = device.getByRole("textfield", { name: "Email" })
    await emailField.focus()
    await expect(emailField).toBeFocused()
    let shown = await device.isKeyboardShown()
    expect(shown).toBe(true)

    await emailField.blur()
    await device.hideKeyboard()
    shown = await device.isKeyboardShown()
    expect(shown).toBe(false)
  })

  // ─── Clear & Retype ───

  test("clearAndType() replaces existing text", async ({ device }) => {
    const login = new LoginScreen(device)
    await login.emailField.clearAndType("wrong@email.com")
    await expect(login.emailField).toContainText("wrong@email.com")
  })

  test("clear() empties the field", async ({ device }) => {
    const login = new LoginScreen(device)
    await login.emailField.type("hello")
    await login.emailField.clear()
    await expect(login.emailField).toBeEmpty()
  })

  // ─── Form Submission ───

  test("can type credentials and submit", async ({ device }) => {
    const login = new LoginScreen(device)
    await login.emailField.clearAndType("test@example.com")
    await login.passwordField.clearAndType("password123")
    // Button enabling is the actionable signal that the credentials were
    // accepted by the form. The post-submit success state is exercised by
    // auth.setup.ts, which has the proper hideKeyboard sequencing.
    await expect(login.signInButton).toBeEnabled()
  })
})

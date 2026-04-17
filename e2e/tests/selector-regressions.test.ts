/**
 * Regression tests for selector and assertion bugs that have been fixed.
 * Each section preserves the original PILOT issue ID so future regressions
 * are easy to triage.
 */
import { beforeEach, describe, expect, test } from "pilot"

describe("Selector & assertion regressions", () => {
  beforeEach(async ({ device }) => {
    await device.restartApp()
  })

  // ─── PILOT-131: testId() now resolves to resource-id ───
  test("PILOT-131: testId() should find element by resource-id", async ({ device }) => {
    await device.getByDescription("Login Form").tap()
    const el = await device.getByTestId("email-input").find()
    expect(el.resourceId).toBe("email-input")
  })

  // ─── PILOT-132: hint() filters by extracted hint attribute ───
  test("PILOT-132: hint() should match by placeholder text", async ({ device }) => {
    await device.getByDescription("Login Form").tap()
    const el = await device.getByPlaceholder("Enter your email").find()
    expect(el.hint).toBe("Enter your email")
  })

  // ─── PILOT-133: type()/clearAndType() must not wrap text in literal quotes ───
  test("PILOT-133: type() should not add quotes around text", async ({ device }) => {
    await device.getByDescription("Login Form").tap()
    await device.getByTestId("email-input").type("test@example.com")
    await expect(device.getByTestId("email-input")).toHaveValue("test@example.com")
  })

  test("PILOT-133: clearAndType() should not add quotes around text", async ({ device }) => {
    await device.getByDescription("Login Form").tap()
    await device.getByTestId("email-input").type("seed text")
    await device.getByTestId("email-input").clearAndType("new@example.com")
    await expect(device.getByTestId("email-input")).toHaveValue("new@example.com")
  })

  // ─── accessibilityRole now flows through to the role attribute ───
  test("accessibilityRole should map to UIAutomator role", async ({ device }) => {
    await expect(device.getByText("Test Screens", { exact: true })).toHaveRole("heading")
  })

  // ─── toContainText now traverses descendant text nodes ───
  test("toContainText should traverse child text nodes", async ({ device }) => {
    await device.getByDescription("Dialogs").tap()
    await device.locator({ id: "show-toast-button" }).tap()
    await expect(device.locator({ id: "toast" })).toContainText("Item saved successfully!")
  })

  // ─── toBeEmpty now ignores placeholder/hint after clear() ───
  test("toBeEmpty should ignore placeholder text after clear", async ({ device }) => {
    await device.getByDescription("Login Form").tap()
    await device.getByTestId("email-input").type("hello")
    await device.getByTestId("email-input").clear()
    await expect(device.getByTestId("email-input")).toBeEmpty()
  })
})

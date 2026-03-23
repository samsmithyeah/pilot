import { test, expect, text } from "pilot"

const PKG = "dev.pilot.testapp"

test("profile redirects to login when not authenticated", async ({ device }) => {
  await device.clearAppData(PKG)
  await device.launchApp(PKG)
  await device.openDeepLink("pilottest:///profile")

  // Without auth, the profile screen should redirect to login
  await expect(device.element(text("Sign In"))).toBeVisible()
})

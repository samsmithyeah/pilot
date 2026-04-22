import { test, expect, describe } from "tapsmith"

const PKG = "dev.tapsmith.testapp"

// ─── Android-only device management tests ───
// These tests use APIs that are only available on Android.
// They are excluded from the iOS test suite via tapsmith.config.ios.mjs.

// ─── App Lifecycle (Android-specific) ───

describe("App lifecycle (Android)", () => {
  test("currentActivity() returns a non-empty activity", async ({ device }) => {
    const activity = await device.currentActivity()
    expect(activity.length).toBeGreaterThan(0)
  })

  test("sendToBackground() backgrounds the app", async ({ device }) => {
    await device.sendToBackground()
    const state = await device.getAppState(PKG)
    expect(state).toBe("background")
  })

  test("bringToForeground() brings the app back", async ({ device }) => {
    await device.bringToForeground(PKG)
    const state = await device.getAppState(PKG)
    expect(state).toBe("foreground")
  })

  test("getAppState() returns 'not_installed' for unknown package", async ({ device }) => {
    const state = await device.getAppState("com.nonexistent.fake.app")
    expect(state).toBe("not_installed")
  })
})

// ─── Deep Links (Android-specific) ───

describe("Deep links (Android)", () => {
  test("navigate back after deep link", async ({ device }) => {
    await device.openDeepLink("tapsmithtest:///login")
    await device.pressBack()
  })
})

// ─── Device Navigation ───

describe("Device navigation", () => {
  test("pressHome() goes to home screen", async ({ device }) => {
    await device.launchApp(PKG)
    await device.pressHome()
    const pkg = await device.currentPackage()
    expect(pkg).not.toBe(PKG)
  })

  test("openNotifications() opens notification shade", async ({ device }) => {
    await device.openNotifications()
  })

  test("pressBack() closes notification shade", async ({ device }) => {
    await device.pressBack()
  })

  test("openQuickSettings() opens quick settings", async ({ device }) => {
    await device.openQuickSettings()
  })

  test("pressBack() closes quick settings", async ({ device }) => {
    await device.pressBack()
  })

  test("pressRecentApps() opens recents", async ({ device }) => {
    await device.pressRecentApps()
    await device.pressBack()
  })
})

// ─── Color Scheme ───

describe("Color scheme", () => {
  test("setColorScheme('dark') enables dark mode", async ({ device }) => {
    await device.setColorScheme("dark")
    const scheme = await device.getColorScheme()
    expect(scheme).toBe("dark")
  })

  test("setColorScheme('light') restores light mode", async ({ device }) => {
    await device.setColorScheme("light")
    const scheme = await device.getColorScheme()
    expect(scheme).toBe("light")
  })
})

// ─── Permissions ───

describe("Permissions", () => {
  test("grantPermission() grants a runtime permission", async ({ device }) => {
    await device.grantPermission(PKG, "android.permission.CAMERA")
  })

  test("revokePermission() revokes a runtime permission", async ({ device }) => {
    await device.revokePermission(PKG, "android.permission.CAMERA")
  })
})

// ─── pressKey (Hardware) ───

describe("Key presses", () => {
  test("pressKey('VOLUME_UP') does not throw", async ({ device }) => {
    await device.pressKey("VOLUME_UP")
  })

  test("pressKey('VOLUME_DOWN') does not throw", async ({ device }) => {
    await device.pressKey("VOLUME_DOWN")
  })
})

// ─── App Data ───

describe("App data", () => {
  test("clearAppData() clears app data, app can be relaunched", async ({ device }) => {
    await device.clearAppData(PKG)
    const state = await device.getAppState(PKG)
    expect(state).toBe("stopped")

    // clearAppData stops the app — relaunch to leave a clean state
    await device.launchApp(PKG)
    const pkg = await device.currentPackage()
    expect(pkg).toBe(PKG)
  })
})

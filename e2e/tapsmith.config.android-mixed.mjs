import "dotenv/config"
import { defineConfig } from "tapsmith"

// ─── Mixed single-device + device-group config, Android ───
//
// One session with two kinds of worker: `solo` drives a single emulator and
// `pair` drives a device group of two (PILOT-310). Exercises the surfaces that
// have to cope with both shapes at once — the UI-mode device rail and panes,
// the test tree's group badge, per-bucket provisioning. Needs three matching
// emulators; Tapsmith launches more instances of the AVD when fewer are
// connected.
//
//   tapsmith test -c tapsmith.config.android-mixed.mjs
//   tapsmith test -c tapsmith.config.android-mixed.mjs --ui

const APP = {
  apk: "../test-app/android/app/build/outputs/apk/release/app-release.apk",
  activity: "dev.tapsmith.testapp.MainActivity",
  package: "dev.tapsmith.testapp",
}

export default defineConfig({
  ...APP,
  timeout: 15_000,
  retries: 0,
  screenshot: "only-on-failure",
  trace: { mode: "retain-on-failure", daemonLogs: true },
  avd: "Tapsmith_Phone_API_36",
  agentApk: "../agent/app/build/outputs/apk/debug/app-debug.apk",
  agentTestApk:
    "../agent/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
  projects: [
    {
      name: "solo",
      testMatch: ["**/home.test.ts", "**/gestures.test.ts", "**/api-calls.test.ts"],
    },
    {
      name: "pair",
      testMatch: ["**/multi-device/**/*.test.ts"],
      use: { devices: [{ name: "alice" }, { name: "bob" }] },
    },
  ],
})

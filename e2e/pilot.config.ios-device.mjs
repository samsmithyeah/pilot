/**
 * E2E config targeting a physical iOS device.
 *
 * Requires:
 *   1. `pilot build-ios-agent` run once to produce the signed xctestrun under
 *      ios-agent/.build-device/ (see docs/ios-physical-devices.md).
 *   2. A device-signed build of the test-app accessible as
 *      test-app/ios/build/Build/Products/Release-iphoneos/PilotTestApp.app
 *      (build via `cd test-app && npx expo run:ios --configuration Release --device <udid>`).
 *
 * The target device UDID is auto-detected from `xcrun devicectl list devices`
 * when exactly one physical iOS device is paired. Set `PILOT_IOS_DEVICE` to
 * override when you have multiple devices or want to target a specific one.
 *
 * Mirrors the simulator config's three-project auth-setup flow. All public
 * iOS APIs that Pilot exposes are now supported on physical devices, so the
 * only tests excluded here are the ones that were always Android-specific.
 */
import "dotenv/config"
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { join, resolve } from "node:path"
import { defineConfig } from "pilot"
import { globSync } from "tinyglobby"

function resolveDeviceUdid() {
  const fromEnv = process.env.PILOT_IOS_DEVICE
  if (fromEnv) return fromEnv
  // Auto-detect via devicectl. We shell out instead of importing the
  // `ios-devicectl` helper from the SDK because the config file runs in
  // a different tsx sandbox from the CLI and cross-package imports get
  // messy. The JSON payload is what we actually care about.
  const scratch = "/tmp/pilot-e2e-devices.json"
  try {
    execFileSync("xcrun", ["devicectl", "list", "devices", "--json-output", scratch], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 15_000,
    })
  } catch {
    // devicectl prints provisioning warnings on stderr for unpaired devices
    // but still writes valid JSON. Swallow and keep going.
  }
  let udids
  try {
    const raw = execFileSync("cat", [scratch], { encoding: "utf8" })
    const data = JSON.parse(raw)
    udids = (data?.result?.devices ?? [])
      .filter((d) => d?.hardwareProperties?.platform === "iOS")
      .filter((d) => d?.connectionProperties?.pairingState === "paired")
      .map((d) => d?.hardwareProperties?.udid)
      .filter((u) => typeof u === "string" && u.length > 0)
  } catch {
    udids = []
  }
  if (udids.length === 1) return udids[0]
  if (udids.length === 0) {
    throw new Error(
      "No paired physical iOS device detected. Run `pilot setup-ios-device` to pair one, " +
        "or set PILOT_IOS_DEVICE to a specific UDID.",
    )
  }
  throw new Error(
    `Multiple paired physical iOS devices detected (${udids.length}): ${udids.join(", ")}. ` +
      "Set PILOT_IOS_DEVICE to pick one.",
  )
}

function findDeviceXctestrun() {
  const pattern = resolve(
    join(import.meta.dirname, "..", "ios-agent", ".build-device", "Build", "Products", "*iphoneos*.xctestrun"),
  )
  const matches = globSync(pattern, { absolute: true }).filter(
    (p) => !p.endsWith(".patched.xctestrun"),
  )
  if (matches.length === 0) {
    throw new Error(
      `No device xctestrun found at ${pattern}.\n` +
        `Run \`pilot build-ios-agent\` first. See docs/ios-physical-devices.md.`,
    )
  }
  return matches.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

export default defineConfig({
  platform: "ios",
  app: "../test-app/ios/build/Build/Products/Release-iphoneos/PilotTestApp.app",
  package: "dev.pilot.testapp",
  timeout: 15_000,
  retries: 0,
  screenshot: "only-on-failure",
  workers: 1,
  trace: "retain-on-failure",
  device: resolveDeviceUdid(),
  daemonBin: "../packages/pilot-core/target/release/pilot-core",
  iosXctestrun: process.env.PILOT_IOS_XCTESTRUN || findDeviceXctestrun(),
  projects: [
    {
      name: "authentication",
      testMatch: ["**/auth.setup.ts"],
    },
    {
      name: "default",
      testMatch: ["**/*.test.ts"],
      testIgnore: ["**/app-state.test.ts", "**/auth-gate.test.ts", "**/*.android.test.ts"],
    },
    {
      name: "authenticated",
      dependencies: ["authentication"],
      use: { appState: "./pilot-results/auth-state-authentication.tar.gz" },
      testMatch: ["**/app-state.test.ts", "**/auth-gate.test.ts"],
    },
  ],
})

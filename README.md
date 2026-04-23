# Tapsmith

**Playwright-level reliability for mobile app testing.**

Tapsmith is a native mobile app testing framework that brings the developer experience of [Playwright](https://playwright.dev) to Android. Write tests in TypeScript, run them against real devices or emulators, and get deterministic results every time.

```typescript
import { test, expect, text, id } from "tapsmith";

test("user can log in", async ({ device }) => {
  await device.type(id("email_input"), "user@example.com");
  await device.type(id("password_input"), "password123");
  await device.tap(text("Sign In"));

  await expect(device.element(text("Welcome back"))).toBeVisible();
});
```

## Key Features

- **Auto-waiting** -- Every action waits for the element to be visible, enabled, and stable before acting. No manual sleeps, no flaky tests.
- **Accessible selectors** -- Find elements the way users do: by role, text, and accessibility labels. Lint rules steer you toward best practices.
- **Screenshots on failure** -- Every failed test captures a screenshot so you can see exactly what went wrong.
- **Familiar API** -- If you know Playwright, you already know Tapsmith. `test`, `describe`, `expect`, and hooks work the way you expect.
- **Fast startup** -- From `npx tapsmith test` to first test executing in under 10 seconds.

## Architecture

```
┌─────────────────────┐       gRPC        ┌──────────────────┐      ADB/socket      ┌──────────────────────┐
│  TypeScript SDK      │ ◄──────────────► │  Rust Core Daemon  │ ◄──────────────────► │  On-Device Agent     │
│  (test runner)       │                   │  (tapsmith-core)   │                      │  (tapsmith-agent.apk) │
│                      │                   │                   │                      │  UIAutomator2 access │
└─────────────────────┘                   └──────────────────┘                      └──────────────────────┘
```

The TypeScript SDK communicates with a Rust daemon over gRPC. The daemon manages ADB connections and routes commands to a lightweight on-device agent that uses UIAutomator2 for element interaction.

## Quick Start

### 1. Install

```bash
npm install tapsmith
```

### 2. Configure

Create `tapsmith.config.ts` in your project root:

```typescript
import { defineConfig } from "tapsmith";

export default defineConfig({
  apk: "./app/build/outputs/apk/debug/app-debug.apk",
});
```

`apk` is the main required setting for clean-device runs. You can also set
`package` to have Tapsmith auto-launch the app before tests, and `activity` as an
optional stability hint if your launcher activity needs to be explicit.

For emulator-managed runs, prefer configuring an AVD instead of pinning a
specific device serial:

```typescript
import { defineConfig } from "tapsmith";

export default defineConfig({
  apk: "./app/build/outputs/apk/debug/app-debug.apk",
  package: "com.example.myapp",
  workers: 4,
  launchEmulators: true,
  avd: "Pixel_9_API_35",
});
```

When `avd` is set, Tapsmith defaults to using instances of that AVD. Set
`deviceStrategy: "prefer-connected"` if you want Tapsmith to reuse unrelated
healthy connected devices first instead.

### 3. Write a test

Create `tests/login.test.ts`:

```typescript
import { test, expect, text, id } from "tapsmith";

test("user can log in", async ({ device }) => {
  await device.type(id("email_input"), "user@example.com");
  await device.type(id("password_input"), "password123");
  await device.tap(text("Sign In"));

  await expect(device.element(text("Welcome back"))).toBeVisible();
});

test("shows error on invalid credentials", async ({ device }) => {
  await device.type(id("email_input"), "bad@example.com");
  await device.type(id("password_input"), "wrong");
  await device.tap(text("Sign In"));

  await expect(device.element(text("Invalid credentials"))).toBeVisible();
});
```

### 4. Run

```bash
npx tapsmith test
```

Single-device debugging is still available with `--device`, but the recommended
emulator-managed path is `workers + launchEmulators + avd`.

## Requirements

- **Node.js** 18 or later
- **ADB** installed and on your PATH (`adb devices` should work)
- **Android device or emulator** connected and visible to ADB

## Documentation

- [Getting Started](docs/getting-started.md)
- [Selectors Guide](docs/selectors.md)
- [API Reference](docs/api-reference.md)
- [Configuration](docs/configuration.md)
- [CI Setup](docs/ci-setup.md)
- [iOS physical devices](docs/ios-physical-devices.md)
- [iOS network capture](docs/ios-network-capture.md)

## License

MIT

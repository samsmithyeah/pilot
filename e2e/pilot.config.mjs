import { defineConfig } from "pilot"

export default defineConfig({
  package: "com.samlovesit.StoryApp",
  timeout: 30_000,
  retries: 0,
  screenshot: "only-on-failure",
  device: "emulator-5554",
  agentApk: "../agent/app/build/outputs/apk/debug/app-debug.apk",
  agentTestApk: "../agent/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
})

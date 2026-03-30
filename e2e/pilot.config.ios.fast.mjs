import { defineConfig } from "pilot"

export default defineConfig({
  platform: "ios",
  app: "/Users/sam/Library/Developer/Xcode/DerivedData/PilotTestApp-datxlahclmztnygrtuayfglnpxkv/Build/Products/Release-iphonesimulator/PilotTestApp.app",
  package: "dev.pilot.testapp",
  timeout: 10_000,
  retries: 0,
  screenshot: "never",
  workers: 1,
  trace: "off",
  simulator: "iPhone 17",
  daemonBin: "../packages/pilot-core/target/release/pilot-core",
  iosXctestrun: "/Users/sam/Library/Developer/Xcode/DerivedData/PilotAgent-fdcquzhwxdmuhlhilgaqynruawga/Build/Products/PilotAgentUITests_PilotAgentUITests_iphonesimulator26.4-arm64.xctestrun",
})

import { describe, expect, test } from "../../fixtures.js"
import { ApiCallsScreen } from "../../screens/api-calls.screen.js"
import { openScreen } from "../../utils/app-reset.js"

// Network capture with a device group (PILOT-310): every member captures on
// its own daemon's proxy, so a request each device makes must surface on that
// device — and only there. Alice and bob hit different endpoints at the same
// time so the trace's Network tab can show one row per device, each anchored
// to that device's own step. On iOS simulators this requires the per-PID
// Network Extension route on both daemons; the host-wide system-proxy
// fallback is refused for groups (see docs/ios-network-capture.md).
describe("Two devices capturing network", () => {
  test.use({ timeout: 20_000 })

  test("each device's requests are captured by its own proxy", async ({ devices: [alice, bob] }) => {
    const aliceApi = new ApiCallsScreen(alice)
    const bobApi = new ApiCallsScreen(bob)
    await Promise.all([openScreen(alice, "/api-calls"), openScreen(bob, "/api-calls")])
    await expect(aliceApi.heading).toBeVisible()
    await expect(bobApi.heading).toBeVisible()

    const aliceUser = alice.waitForResponse((r) => r.url.includes("/users/1"), { timeout: 15_000 })
    const bobPosts = bob.waitForResponse((r) => r.url.includes("/posts"), { timeout: 15_000 })

    await Promise.all([aliceApi.fetchUserButton.tap(), bobApi.fetchPostsButton.tap()])

    const [userResponse, postsResponse] = await Promise.all([aliceUser, bobPosts])
    expect(userResponse.status).toBe(200)
    expect(postsResponse.status).toBe(200)
    await expect(aliceApi.userHeading).toBeVisible()
    await expect(bobApi.postsHeading).toBeVisible()
  })
})

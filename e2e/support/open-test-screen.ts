import { expect, text, type Device } from "pilot"

export async function openTestScreen(
  device: Device,
  route: string,
  readyText: string,
): Promise<void> {
  await device.openDeepLink("pilottest:///")
  await expect(device.element(text("Test Screens"))).toBeVisible()
  await device.openDeepLink(`pilottest:///${route}`)
  await expect(device.element(text(readyText))).toBeVisible()
  // Brief settle for the iOS accessibility tree to fully update after
  // deep link navigation. Without this, the first tap after navigation
  // can fail because the snapshot coordinates are stale.
  await new Promise((r) => setTimeout(r, 500))
}

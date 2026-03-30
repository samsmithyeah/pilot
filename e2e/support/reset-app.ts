import { contentDesc, expect, text, type Device } from "pilot"

export async function resetTestApp(device: Device): Promise<void> {
  await device.tap(contentDesc("Pilot Reset"))
  await expect(device.element(text("Test Screens"))).toBeVisible()
}

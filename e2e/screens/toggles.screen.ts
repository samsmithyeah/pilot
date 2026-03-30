import { type Device, id, text } from "pilot"

export class TogglesScreen {
  constructor(private device: Device) {}

  // Section headings
  get switchesHeading() { return this.device.element(text("Switches")) }
  get agreementStatus() { return this.device.element(id("agreement-status")) }
  get selectedSizeStatus() { return this.device.element(id("selected-size")) }

  // Switches
  get darkModeSwitch() { return this.device.element(id("dark-mode-switch")) }
  get notificationsSwitch() { return this.device.element(id("notifications-switch")) }

  // Checkboxes
  get agreeCheckbox() { return this.device.element(id("agree-checkbox")) }

  // Radio buttons
  get radioSmall() { return this.device.element(id("radio-small")) }
  get radioMedium() { return this.device.element(id("radio-medium")) }
  get radioLarge() { return this.device.element(id("radio-large")) }
  get smallLabel() { return this.device.element(text("Small")) }
  get mediumLabel() { return this.device.element(text("Medium")) }
  get largeLabel() { return this.device.element(text("Large")) }
}

import { id, type Device, text } from "pilot"

export class SlowLoadScreen {
  constructor(private device: Device) {}

  get heading() { return this.device.element(text("Slow Loading")) }
  get load2sButton() { return this.device.element(id("load-2s")) }
  get load5sButton() { return this.device.element(id("load-5s")) }
  get loadFailButton() { return this.device.element(id("load-fail")) }
  get startCounter() { return this.device.element(text("Start Counter")) }

  get profileHeading() { return this.device.element(text("User Profile")) }
  get profileName() { return this.device.element(text("John Doe")) }
  get emailLabel() { return this.device.element(text("Email")) }
  get emailValue() { return this.device.element(text("john@example.com")) }
  get errorMessage() { return this.device.element(text("Network request failed: timeout")) }
}

import { id, type Device, text, textContains } from "pilot"

export class ApiCallsScreen {
  constructor(private device: Device) {}

  get heading() { return this.device.element(text("API Calls")) }
  get description() {
    return this.device.element(text("Makes real HTTP requests to jsonplaceholder.typicode.com"))
  }
  get fetchPostsButton() { return this.device.element(id("fetch-posts")) }
  get fetchUserButton() { return this.device.element(id("fetch-user")) }
  get fetch404Button() { return this.device.element(id("fetch-404")) }
  get postsHeading() { return this.device.element(text("Posts")) }
  get userHeading() { return this.device.element(text("User")) }
  get errorMessage() { return this.device.element(textContains("Request failed")) }
}

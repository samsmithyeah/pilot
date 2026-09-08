import { test, expect } from "../fixtures.js"
import { GESTURES_FILE } from "../messages/scenarios.js"
import { NetworkPane } from "../../panes/network.pane.js"
import { networkEntry } from "../../trace-viewer/trace-builder.js"

const FULL_NAME = "Gestures screen > double tap registers double tap gesture"
const HINT = "Enable network capture in your trace config to record HTTP requests."

test("network requests and selected bodies update while the test is running", async ({ app, detailTabs, page, explorer }) => {
  app.send({ type: "run-start", fileCount: 1 })
  app.send({ type: "test-start", fullName: FULL_NAME, filePath: GESTURES_FILE })
  app.send({ type: "network", testFullName: FULL_NAME, entries: [], networkCaptureEnabled: true })
  await explorer.expandAll()
  await explorer.clickNode("double tap registers double tap gesture")
  await detailTabs.select("Network")
  await expect(detailTabs.noContent).toContainText("No network requests captured")
  await expect(page.getByText(HINT)).toHaveCount(0)

  const network = new NetworkPane(page)
  const entry = {
    ...networkEntry({ index: 7, url: "https://example.com/Listen", contentType: "text/plain" }),
    inFlight: true, responseBodyPath: "network/res-7.bin",
  }
  const snapshot = (body: string, inFlight: boolean) => app.send({
    type: "network", testFullName: FULL_NAME, networkCaptureEnabled: true,
    bodyMode: "patch", entries: [{ ...entry, inFlight }], bodies: { "network/res-7.bin": Buffer.from(body).toString("base64") },
  })
  snapshot("partial", true)
  await expect(network.rows).toHaveCount(1)
  await expect(network.rows.first()).toContainText("Streaming")
  await network.selectRow("Listen")
  await network.openDetailTab("Response")
  await expect(network.detailBody).toContainText("partial")
  app.send({ type: "network", testFullName: FULL_NAME, bodyMode: "patch", entries: [{ ...entry, duration: 9000 }], bodies: {} })
  await expect(network.detailBody).toContainText("partial")
  snapshot("partial grown", true)
  await expect(network.detailBody).toContainText("partial grown")
  snapshot("complete", false)
  await expect(network.detailBody).toContainText("complete")
  await expect(network.rows).toHaveCount(1)
  await expect(network.rows.first()).not.toContainText("Streaming")
  app.send({ type: "network", testFullName: FULL_NAME, bodyMode: "patch", entries: [], bodies: {} })
  await expect(network.rows).toHaveCount(0)
  app.send({ type: "network", testFullName: FULL_NAME, bodyMode: "patch", entries: [entry], bodies: { "network/res-7.bin": Buffer.from("new attempt").toString("base64") } })
  await network.selectRow("Listen")
  await network.openDetailTab("Response")
  await expect(network.detailBody).toContainText("new attempt")
  await expect(network.detailBody).not.toContainText("complete")
  // No test-status or run-end message: all updates occurred during execution.
})

for (const enabled of [true, false, undefined]) {
  test(`empty network hint requires explicit disabled capture (${enabled})`, async ({ app, detailTabs, page, explorer }) => {
    app.send({ type: "run-start", fileCount: 1 })
    app.send({ type: "test-start", fullName: FULL_NAME, filePath: GESTURES_FILE })
    app.send({ type: "network", testFullName: FULL_NAME, entries: [], networkCaptureEnabled: enabled })
    await explorer.expandAll()
    await explorer.clickNode("double tap registers double tap gesture")
    await detailTabs.select("Network")
    await expect(detailTabs.noContent).toContainText("No network requests captured")
    await expect(page.getByText(HINT)).toHaveCount(enabled === false ? 1 : 0)
  })
}

test('keeps inherited request timing across live updates, completion and reruns', async ({ app, detailTabs, page, explorer }) => {
  const start = 1_700_000_000_000
  const testStart = start + 42 * 60_000
  app.send({ type: 'run-start', fileCount: 1 })
  app.send({ type: 'test-start', fullName: FULL_NAME, filePath: GESTURES_FILE })
  await explorer.expandAll()
  await explorer.clickNode('double tap registers double tap gesture')
  await detailTabs.select('Network')
  const network = new NetworkPane(page)
  const snapshot = (observedStartTime: number, endTime: number, inFlight: boolean) => app.send({
    type: 'network', testFullName: FULL_NAME, bodyMode: 'patch', entries: [{
      ...networkEntry({ index: 0, url: 'http://test/Listen' }),
      startTime: start, observedStartTime, endTime, duration: endTime - start, inFlight,
    }], bodies: {},
  })
  snapshot(testStart, testStart + 1000, true)
  await expect(network.row('Listen')).toContainText('Started before this test')
  await expect(network.row('Listen')).toContainText('1.00 s')
  await network.selectRow('Listen')
  await network.openDetailTab('Timing')
  snapshot(testStart, testStart + 5000, true)
  await expect(network.row('Listen')).toContainText('5.00 s')
  await expect(network.detailBody).toContainText('42 min 5 s')
  snapshot(testStart, testStart + 6000, false)
  await expect(network.detailBody).toContainText('Total request duration')
  await expect(network.row('Listen')).toContainText('Started before this test')
  app.send({ type: 'network', testFullName: FULL_NAME, bodyMode: 'patch', entries: [], bodies: {} })
  snapshot(testStart + 30_000, testStart + 31_000, true)
  await expect(network.row('Listen')).toContainText('1.00 s')
  await expect(network.row('Listen')).not.toContainText('6.00 s')
})

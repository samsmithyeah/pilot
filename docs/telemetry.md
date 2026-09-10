# Telemetry

Tapsmith collects a small amount of **anonymous usage data** by default. This page lists exactly what is sent, what never is, and how to turn it off in one line.

Without usage numbers there is no way to tell five users from five thousand, which leaves nothing to prioritise against. That is the whole reason this exists, and transparency about it is the whole reason it is acceptable.

## Opting out

Any one of these disables telemetry completely. Nothing is sent, and no anonymous id is created.

```typescript
// tapsmith.config.ts
import { defineConfig } from "tapsmith";

export default defineConfig({
  telemetry: false,
});
```

```bash
# Per shell / per CI job — wins over the config in the "off" direction
TAPSMITH_TELEMETRY=0 npx tapsmith test
```

```bash
# The cross-tool convention (https://consoledonottrack.com) is honoured too
DO_NOT_TRACK=1 npx tapsmith test
```

The environment variable can switch telemetry **off** for a run whose shared config leaves it on. It cannot switch it **on** when the config says `telemetry: false`.

## What is collected

One event is sent when a **test file finishes running**, plus a one-off `install` event the first time a machine creates its anonymous id. Every event carries:

| Field | Example | Why |
|---|---|---|
| `event` | `"run"` or `"install"` | Distinguish first installs from ongoing use. |
| `anonymousId` | `"7f3c…"` | A random UUID stored in `~/.tapsmith/telemetry.json`. Not derived from your machine, user, or project. Lets runs from one machine be counted once. |
| `sessionId` | `"a91e…"` | A random UUID per Tapsmith process, never stored. Groups the files of one run. |
| `timestamp` | `"2026-09-10T14:03:11.412Z"` | When the event happened. |
| `sdkVersion` | `"0.4.1"` | Which Tapsmith versions are in use. |
| `nodeVersion` | `"v22.21.0"` | Which Node versions to keep supporting. |
| `os` | `"darwin"` | Host operating system (`darwin`, `linux`, `win32`). |
| `arch` | `"arm64"` | Host CPU architecture. |
| `ci` | `true` | Whether the run was on CI (the `CI` environment variable). |

`run` events add:

| Field | Example | Why |
|---|---|---|
| `run.mode` | `"test"` | Which run path executed the file: `test` (sequential CLI), `test-parallel` (`--workers N`), `ui` (UI mode), `watch` (headless watch mode), `mcp` (the MCP server's `tapsmith_run_tests`). |
| `run.platform` | `"android"` | `android` or `ios`. |
| `run.devices` | `1` | Size of the device group the file ran on (`use.devices`). |
| `run.tests` / `run.passed` / `run.failed` / `run.skipped` | `12` / `11` / `1` / `0` | Counts only. |
| `run.durationMs` | `48211` | How long the file took. |

That is the complete list. The payload is a closed set of fields, and Tapsmith's own unit tests assert exactly that key set so it cannot widen by accident.

## What is never collected

- Test names, describe names, or the contents of test files
- Selectors, element text, screenshots, hierarchies, or traces
- App identifiers (`package`, bundle ids), APK/app paths, or anything from your config other than the boolean `telemetry` key
- File paths, project names, or repository names
- Device serials, UDIDs, device names, hostnames, usernames, or email addresses
- IP-derived location (the collector does not store addresses)
- Anything from your app's network traffic

## The first-run notice

The first time Tapsmith runs tests on a machine it prints a short notice to stderr saying that telemetry is on and how to opt out, then records that the notice was shown (in the same state file as the anonymous id) so it never prints again on that machine. Nobody should learn about this from a firewall log.

## How it is sent

- One HTTPS `POST` per finished test file to `https://telemetry.tapsmith.dev/v1/events`, fire-and-forget, bounded by a 3-second timeout.
- Failures are silent. Telemetry never slows a run down, never prints a warning, and never changes an exit code — an offline CI machine behaves identically.
- After three consecutive failures Tapsmith stops trying for the rest of the process.
- Forked worker processes (parallel workers, UI-mode workers, watch-mode children) report their own files and inherit your opt-out.

## The anonymous id

The id lives in `~/.tapsmith/telemetry.json`, owner-readable only:

```json
{
  "anonymousId": "7f3c1d3a-9d0f-4a9c-b0a5-6d2f4e1c8a11",
  "createdAt": "2026-09-10T14:02:58.001Z",
  "noticeShown": true
}
```

Delete the file to rotate the id (the next run counts as a new install and prints the notice again). If the file cannot be written — a read-only home directory, say — Tapsmith uses a throwaway id for that process and sends no `install` event.

## Pointing telemetry somewhere else

`TAPSMITH_TELEMETRY_ENDPOINT` overrides the collector URL, for organisations that want to receive their own copy or route through a proxy:

```bash
TAPSMITH_TELEMETRY_ENDPOINT=https://telemetry.internal.example.com/tapsmith npx tapsmith test
```

The payload is the JSON documented above, sent with `Content-Type: application/json`.

## Where this is implemented

Everything lives in one module, `packages/tapsmith/src/telemetry.ts`, so there is a single place to audit. The runner reports the event; each of the five run paths declares which mode it is (a required option, so a new run path cannot forget to). The unit tests in `packages/tapsmith/src/__tests__/telemetry.test.ts` pin the field list, the opt-outs, and the never-fails behaviour.

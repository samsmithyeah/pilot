# iOS network capture

Pilot can record the HTTP/HTTPS traffic the app under test makes during iOS tests, with full request/response bodies, headers, timing, and per-test attribution in the trace viewer's Network tab. On iOS simulators this works out of the box (with a one-time setup step). Physical iOS devices are not yet supported.

## How it works

Pilot's daemon (`pilot-core`) runs a local MITM proxy for each worker. On Android the daemon uses `adb reverse` to forward the proxy port onto the device and configures the device's HTTP proxy setting. **On iOS**, it uses a different mechanism because simulators share the host's network stack:

- The daemon spawns **`Mitmproxy Redirector.app`**, a small signed launcher that ships with [mitmproxy](https://mitmproxy.org) and manages a macOS **Network Extension** (NE). The NE intercepts TCP flows from specific PIDs on the host and redirects them over a per-worker Unix socket into Pilot's MITM proxy.
- The daemon resolves the booted simulator's process tree (`launchd_sim` and descendants) and sends the resulting PID list to the NE as an `InterceptConf`. The NE filters traffic per-PID, so each worker daemon only sees its own simulator's flows — **parallel iOS workers don't collide**, and the user's host browser traffic is never touched.
- The MITM proxy reads the real hostname from the client's TLS ClientHello SNI extension (not the resolved IP the NE reports), dials upstream with that hostname as SNI, mints a per-host certificate signed by the Pilot CA, and captures the decrypted request/response pair into the trace.

The CA is installed into the simulator's trust store automatically via `xcrun simctl keychain add-root-cert` at the start of each capture session.

## First-run setup

**Prerequisite:** macOS with [Homebrew](https://brew.sh).

1. **Install mitmproxy.** This puts the redirector `.app` in place:

   ```sh
   brew install mitmproxy
   ```

2. **Unpack the redirector.** Mitmproxy lazily unpacks the redirector from its cask tarball into `/Applications/Mitmproxy Redirector.app` on the first run. Trigger the unpack:

   ```sh
   sudo mitmproxy --mode local:Safari
   ```

   Press `q` to quit mitmproxy after it launches. (You only need to do this once per machine; the redirector persists.) The `sudo` is only required because `/Applications` is not writable by admin users directly on macOS Tahoe — mitmproxy writes as root.

3. **Approve the System Extension.** The first time the redirector is launched, macOS prompts to allow its Network Extension:

   - Open **System Settings → General → Login Items & Extensions**
   - Scroll to **Network Extensions**, click the **(i)** info button
   - Toggle **Mitmproxy Redirector** on (you'll be asked for your password)
   - Verify:

     ```sh
     systemextensionsctl list
     ```

     You should see a row ending in `[activated enabled]` for `org.mitmproxy.macos-redirector.network-extension`.

That's it. From this point on, running `npx pilot test` with iOS network capture enabled (the default when tracing is on) will silently spawn the redirector and route traffic through Pilot's MITM proxy.

## Configuration

Network capture is on by default whenever tracing is enabled. Control it via the `network` field in `TraceConfig`:

```typescript
// pilot.config.mjs
import { defineConfig } from "pilot";

export default defineConfig({
  platform: "ios",
  trace: {
    mode: "retain-on-failure",
    network: true, // default — set to false to disable capture
  },
  // ...
});
```

To opt out of iOS network capture entirely, set `network: false`. No mitmproxy install or SE approval is needed in that case.

### Overriding the redirector location

By default, Pilot looks for the redirector at:

1. The path in `$PILOT_REDIRECTOR_APP` (if set)
2. `/Applications/Mitmproxy Redirector.app/Contents/MacOS/Mitmproxy Redirector` (the brew unpack location)
3. `~/.pilot/redirector/Mitmproxy Redirector.app/Contents/MacOS/Mitmproxy Redirector` (on-demand extract from the brew cask tarball)

Set `PILOT_REDIRECTOR_APP=/path/to/Mitmproxy Redirector.app/Contents/MacOS/Mitmproxy Redirector` to point at a custom location (e.g. a CI-managed redirector, or a hand-signed Pilot fork).

## CI setup

See the [iOS network capture on CI](./ci-setup.md#ios-network-capture-on-ci) section for `brew install mitmproxy` + SE approval on CI runners.

## Troubleshooting

### `Mitmproxy Redirector.app not found`

The redirector binary is missing. Run the [first-run setup](#first-run-setup) above, or set `PILOT_REDIRECTOR_APP` to point at an existing redirector binary. The error message lists the fallback search paths.

### System Extension is installed but `[activated waiting for user]`

You installed the SE but haven't approved it yet. Go to **System Settings → General → Login Items & Extensions → Network Extensions → (i)** and toggle it on. The state should change to `[activated enabled]`.

### Network entries missing from the trace (`network.json` not in the archive)

Check the daemon logs — run `pilot test` with `RUST_LOG=pilot_core=debug` and look for lines from `pilot_core::ios_redirect` (control channel connection, initial InterceptConf, intercepted flows) and `pilot_core::network_proxy` (MITM handshakes). Common causes:

- **`failed reading TLS ClientHello`** — the app closed the connection before sending the handshake. Usually a transient issue; rerun the test.
- **`upstream TLS handshake failed for <host>: UnknownIssuer`** — the upstream server uses a certificate chain not in Pilot's webpki roots. This affects some Apple-internal services; it does not affect standard public HTTPS endpoints.
- **`simulator_processes returned 0 PIDs`** — the simulator isn't booted, or `ps` parsing couldn't find it. Check `xcrun simctl list devices booted`.

### My host's web browser traffic went through Pilot's proxy

This should not happen with PILOT-182's NE-based approach. The NE filters by PID, so only the simulator's process tree's traffic is redirected; your browser's PID is not in the filter. If you are still seeing host traffic being affected, check that `networksetup -getwebproxy Wi-Fi` shows `Enabled: No`. If a stale proxy setting is still configured from a pre-PILOT-182 Pilot version, clear it with:

```sh
sudo networksetup -setwebproxystate Wi-Fi off
sudo networksetup -setsecurewebproxystate Wi-Fi off
```

You can also remove the (no-longer-used) legacy sudoers file:

```sh
sudo rm /etc/sudoers.d/zzz-pilot-networksetup
```

Pilot itself never modifies these on modern versions.

### Parallel iOS workers still see empty network tabs

Verify the fix is in place: run with debug logs and look for `pilot_core::ios_redirect` lines showing **different `/tmp/pilot-redirector-*.sock` paths per worker**. Each worker daemon should have its own session. If multiple workers share a socket path, you are running an older build — upgrade.

### Physical iOS device network capture

Not supported yet. The NE redirector only intercepts traffic originating on the host (which is where simulators run). Physical devices need a different mechanism (a Wi-Fi proxy config profile pointing at the host's local IP, or a USB tunnel via `iproxy`) which is planned follow-up work.

## Security and privacy

- The Pilot CA is generated once per machine and stored under `~/.pilot/ca.pem`. It is installed into the simulator's trust store at the start of each capture session and removed at the end.
- Only traffic from the simulator's process tree (as reported by `ps`) is routed through the proxy. Host browsers, IDEs, and other apps are unaffected.
- The macOS system proxy (`networksetup -setwebproxy`) is never modified. Pilot's PILOT-182 architecture removed all host-level proxy configuration.
- Request and response bodies are truncated to 1 MiB each in the captured trace to prevent runaway memory usage.

## Attribution

Pilot's iOS network capture builds on the [mitmproxy](https://mitmproxy.org) project's `mitmproxy_rs` macOS redirector, which is MIT-licensed. Specifically, Pilot vendors the `mitmproxy_ipc.proto` schema (in `packages/pilot-core/vendor/mitmproxy_ipc.proto`) and depends at runtime on the `Mitmproxy Redirector.app` binary shipped with `brew install mitmproxy`. Pilot does not bundle or fork mitmproxy itself.

MIT License © Mitmproxy contributors — see the [mitmproxy_rs LICENSE](https://github.com/mitmproxy/mitmproxy_rs/blob/main/LICENSE).

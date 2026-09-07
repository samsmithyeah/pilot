import { networkInterfaces } from "node:os"

/**
 * How the app under test reaches a server this test process hosts.
 *
 * Android emulators see the host as `10.0.2.2`. iOS simulators share the Mac's
 * network stack, so `localhost` would work for the app — but it is invisible
 * to network capture: macOS never offers loopback flows to the Network
 * Extension redirector, and the system-proxy fallback bypasses `localhost`.
 * Addressing the Mac by its LAN IPv4 keeps the request on a real interface,
 * where the simulator's daemon captures it like any other request.
 *
 * Prefers a wired/Wi-Fi interface (`en*`) and skips CGNAT space
 * (`100.64.0.0/10`, i.e. Tailscale) so a VPN never wins over the LAN.
 */
export function hostAddressFor(platform: "android" | "ios"): string {
  if (platform === "android") return "10.0.2.2"

  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? [])
      .filter((a) => a.family === "IPv4" && !a.internal)
      .map((a) => ({ name, address: a.address })),
  )
  const isCgnat = (ip: string) => {
    const [a, b] = ip.split(".").map(Number)
    return a === 100 && b >= 64 && b <= 127
  }
  const pick =
    candidates.find((c) => /^en\d+$/.test(c.name) && !isCgnat(c.address)) ??
    candidates.find((c) => !isCgnat(c.address)) ??
    candidates[0]
  if (!pick) {
    throw new Error(
      "No non-loopback IPv4 address on this Mac — the simulator has no route to a test-hosted server",
    )
  }
  return pick.address
}

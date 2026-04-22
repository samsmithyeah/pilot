# MCP Server

Tapsmith includes a built-in [MCP](https://modelcontextprotocol.io/) server that lets AI coding agents run tests, interact with devices, and inspect results through a standardized tool interface.

## Modes

The MCP server operates in two modes:

### SSE mode (recommended)

When running `tapsmith test --ui`, an SSE MCP endpoint is hosted alongside the UI. The agent shares the same daemon, device, and test session as the UI — test runs appear in the UI with full progress tracking, and both the agent and user share mutual exclusion (only one run at a time).

This mode has **16 tools** including test discovery, result browsing, watch mode, and session info.

To connect, copy the SSE URL from the MCP panel in the UI, or run:

```bash
claude mcp add tapsmith --transport sse http://localhost:9274/mcp
```

The MCP panel in the UI shows the connection status and a live activity feed of all tool calls.

### Stdio mode

Run `tapsmith mcp-server` as a standalone subprocess. The agent gets its own daemon and device, fully independent from any UI session.

This mode has **11 tools** — device interaction and test execution, but no session-aware tools (test tree, results, watch, stop).

```bash
claude mcp add tapsmith -- tapsmith mcp-server
```

If a UI server is already running, stdio mode will detect it and suggest connecting via SSE instead.

## Tools

### Device interaction (both modes)

| Tool | Description |
|---|---|
| `tapsmith_snapshot` | Get the accessibility tree with suggested selectors for each interactive element |
| `tapsmith_screenshot` | Capture a PNG screenshot of the device screen |
| `tapsmith_test_selector` | Validate a selector string against the current screen |
| `tapsmith_tap` | Tap an element matching a selector |
| `tapsmith_type` | Type text into an element |
| `tapsmith_swipe` | Perform a swipe gesture |
| `tapsmith_press_key` | Press a device key (Back, Home, Enter, etc.) |
| `tapsmith_launch_app` | Launch or restart the app |
| `tapsmith_list_devices` | List connected devices and emulators |

### Test execution (both modes)

| Tool | Description |
|---|---|
| `tapsmith_run_tests` | Run test files with optional test name and project filters. In SSE mode, runs appear in the UI. On failure, returns error details, trace steps, and a screenshot. |
| `tapsmith_read_trace` | Read a trace archive for step-by-step debugging |

### Session tools (SSE mode only)

| Tool | Description |
|---|---|
| `tapsmith_list_tests` | List the full test tree — projects, files, suites, and test names |
| `tapsmith_list_results` | Browse test results from the current session, with optional status/file filters. Pass `details: true` for trace steps on failures. |
| `tapsmith_stop_tests` | Stop a running test execution |
| `tapsmith_session_info` | Get session config: platform, device, package, timeout, retries, and per-project settings |
| `tapsmith_watch` | Toggle watch mode on a file or test — auto-reruns on save |

## Typical workflow

1. Start the UI: `tapsmith test --ui`
2. Connect your agent to the SSE endpoint shown in the MCP panel
3. The agent uses `tapsmith_session_info` to understand the environment
4. Uses `tapsmith_list_tests` to discover available tests
5. Uses `tapsmith_snapshot` to see what's on screen, `tapsmith_test_selector` to validate selectors
6. Runs tests with `tapsmith_run_tests`, gets inline failure details
7. Uses `tapsmith_list_results` to review results, `tapsmith_read_trace` to dig into failures
8. Toggles `tapsmith_watch` on files being actively developed

## Multi-project support

When the config defines multiple projects (e.g. `android` and `ios`), all session-aware tools respect project scoping:

- `tapsmith_run_tests` accepts a `project` parameter to target a specific project
- `tapsmith_list_tests` shows the full tree grouped by project
- `tapsmith_list_results` includes the project name for each result
- `tapsmith_watch` accepts a `project` parameter to scope the watch

Use `tapsmith_session_info` to see available projects and their configuration.

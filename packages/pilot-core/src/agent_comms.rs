use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};

use crate::adb;

/// Port the on-device agent listens on (device side).
const AGENT_DEVICE_PORT: u16 = 18700;

/// Local port we forward to.
const AGENT_HOST_PORT: u16 = 18700;

/// Default timeout for agent commands.
const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

// ─── Agent Command Protocol ───
//
// Commands are serialized as: {"id": "uuid", "method": "methodName", "params": {...}}
// to match what the on-device Android agent expects.

#[derive(Debug, Clone)]
pub enum AgentCommand {
    FindElement {
        selector: Value,
        timeout_ms: Option<u64>,
    },
    FindElements {
        selector: Value,
        timeout_ms: Option<u64>,
    },
    Tap {
        selector: Value,
        timeout_ms: Option<u64>,
    },
    LongPress {
        selector: Value,
        duration_ms: Option<u64>,
        timeout_ms: Option<u64>,
    },
    TypeText {
        selector: Value,
        text: String,
        timeout_ms: Option<u64>,
    },
    ClearText {
        selector: Value,
        timeout_ms: Option<u64>,
    },
    Swipe {
        direction: String,
        start_element: Option<Value>,
        speed: Option<f32>,
        distance: Option<f32>,
        timeout_ms: Option<u64>,
    },
    Scroll {
        container: Option<Value>,
        direction: String,
        scroll_until_visible: Option<Value>,
        distance: Option<f32>,
        timeout_ms: Option<u64>,
    },
    PressKey {
        key: String,
    },
    GetUiHierarchy {},
    WaitForIdle {
        timeout_ms: Option<u64>,
    },
    Screenshot {},
}

impl AgentCommand {
    /// Serialize into the JSON protocol format: {"id": "...", "method": "...", "params": {...}}
    fn to_json(&self, id: &str) -> Value {
        let (method, params) = match self {
            AgentCommand::FindElement { selector, timeout_ms } => {
                let mut p = selector.clone();
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("findElement", p)
            }
            AgentCommand::FindElements { selector, timeout_ms } => {
                let mut p = selector.clone();
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("findElements", p)
            }
            AgentCommand::Tap { selector, timeout_ms } => {
                let mut p = selector.clone();
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("tap", p)
            }
            AgentCommand::LongPress { selector, duration_ms, timeout_ms } => {
                let mut p = selector.clone();
                if let Some(d) = duration_ms { p["duration"] = json!(d); }
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("longPress", p)
            }
            AgentCommand::TypeText { selector, text, timeout_ms } => {
                let mut p = selector.clone();
                p["text"] = json!(text);
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("typeText", p)
            }
            AgentCommand::ClearText { selector, timeout_ms } => {
                let mut p = selector.clone();
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("clearText", p)
            }
            AgentCommand::Swipe { direction, start_element, speed, distance, timeout_ms } => {
                let mut p = json!({"direction": direction});
                if let Some(se) = start_element { p["startElement"] = se.clone(); }
                if let Some(s) = speed { p["speed"] = json!(s); }
                if let Some(d) = distance { p["distance"] = json!(d); }
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("swipe", p)
            }
            AgentCommand::Scroll { container, direction, scroll_until_visible, distance, timeout_ms } => {
                let mut p = json!({"direction": direction});
                if let Some(c) = container { p["container"] = c.clone(); }
                if let Some(sv) = scroll_until_visible { p["scrollTo"] = sv.clone(); }
                if let Some(d) = distance { p["distance"] = json!(d); }
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("scroll", p)
            }
            AgentCommand::PressKey { key } => {
                ("pressKey", json!({"key": key}))
            }
            AgentCommand::GetUiHierarchy {} => {
                ("getUiHierarchy", json!({}))
            }
            AgentCommand::WaitForIdle { timeout_ms } => {
                let mut p = json!({});
                if let Some(t) = timeout_ms { p["timeout"] = json!(t); }
                ("waitForIdle", p)
            }
            AgentCommand::Screenshot {} => {
                ("screenshot", json!({}))
            }
        };

        json!({
            "id": id,
            "method": method,
            "params": params
        })
    }
}

/// Response from the on-device agent.
/// Format: {"id": "...", "result": {...}} or {"id": "...", "error": {"type": "...", "message": "..."}}
#[derive(Debug, Clone)]
pub struct AgentResponse {
    pub success: bool,
    pub error: Option<String>,
    pub error_type: Option<String>,
    pub data: Value,
}

impl AgentResponse {
    fn from_json(value: &Value) -> Self {
        if let Some(error) = value.get("error") {
            AgentResponse {
                success: false,
                error: error.get("message").and_then(|v| v.as_str()).map(String::from),
                error_type: error.get("type").and_then(|v| v.as_str()).map(String::from),
                data: Value::Null,
            }
        } else {
            AgentResponse {
                success: true,
                error: None,
                error_type: None,
                data: value.get("result").cloned().unwrap_or(Value::Null),
            }
        }
    }
}

// ─── Connection Management ───

/// Manages the TCP connection to the on-device Pilot agent.
#[derive(Debug)]
pub struct AgentConnection {
    connected: bool,
    device_serial: Option<String>,
}

impl AgentConnection {
    pub fn new() -> Self {
        Self {
            connected: false,
            device_serial: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// Establish port forwarding and verify the agent is reachable.
    pub async fn connect(&mut self, serial: &str) -> Result<()> {
        // Set up ADB port forwarding
        adb::forward_port(serial, AGENT_HOST_PORT, AGENT_DEVICE_PORT)
            .await
            .context("Failed to set up ADB port forwarding to agent")?;

        // Try to connect and send a ping
        match self.ping_agent().await {
            Ok(_) => {
                self.connected = true;
                self.device_serial = Some(serial.to_string());
                info!(serial, "Connected to on-device agent");
                Ok(())
            }
            Err(e) => {
                // Clean up the forwarding on failure
                let _ = adb::remove_forward(serial, AGENT_HOST_PORT).await;
                bail!("Agent is not responding on device {serial}: {e}. Is the agent app running?");
            }
        }
    }

    /// Disconnect and clean up port forwarding.
    pub async fn disconnect(&mut self) {
        if let Some(ref serial) = self.device_serial {
            let _ = adb::remove_forward(serial, AGENT_HOST_PORT).await;
        }
        self.connected = false;
        self.device_serial = None;
        debug!("Agent disconnected");
    }

    /// Send a command to the agent and wait for a response.
    pub async fn send_command(&mut self, command: &AgentCommand) -> Result<AgentResponse> {
        self.send_command_with_timeout(command, DEFAULT_COMMAND_TIMEOUT)
            .await
    }

    /// Send a command with a specific timeout.
    pub async fn send_command_with_timeout(
        &mut self,
        command: &AgentCommand,
        timeout: Duration,
    ) -> Result<AgentResponse> {
        if !self.connected {
            bail!("Not connected to agent. Call StartAgent or connect first.");
        }

        // Attempt the command, reconnect once on connection failure
        match self.try_send_command(command, timeout).await {
            Ok(resp) => Ok(resp),
            Err(e) => {
                warn!("Agent command failed, attempting reconnect: {e}");

                if let Some(serial) = self.device_serial.clone() {
                    self.reconnect(&serial).await?;
                    self.try_send_command(command, timeout).await
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn try_send_command(
        &self,
        command: &AgentCommand,
        timeout: Duration,
    ) -> Result<AgentResponse> {
        let mut stream = tokio::time::timeout(Duration::from_secs(5), async {
            TcpStream::connect(format!("127.0.0.1:{AGENT_HOST_PORT}")).await
        })
        .await
        .map_err(|_| anyhow!("Timed out connecting to agent socket"))?
        .context("Failed to connect to agent socket")?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let json_msg = command.to_json(&request_id);
        let payload = serde_json::to_string(&json_msg).context("Failed to serialize command")?;
        debug!(payload = %payload, "Sending command to agent");

        // Write the command as a newline-delimited JSON message
        stream
            .write_all(payload.as_bytes())
            .await
            .context("Failed to write to agent socket")?;
        stream
            .write_all(b"\n")
            .await
            .context("Failed to write newline to agent socket")?;
        stream.flush().await?;

        // Read the response (newline-delimited JSON)
        let reader = BufReader::new(&mut stream);
        let mut line = String::new();

        tokio::time::timeout(timeout, async {
            let mut reader = reader;
            reader
                .read_line(&mut line)
                .await
                .context("Failed to read from agent socket")
        })
        .await
        .map_err(|_| anyhow!("Agent command timed out after {timeout:?}"))??;

        let line = line.trim();
        if line.is_empty() {
            bail!("Agent returned empty response");
        }

        debug!(response = %line, "Received response from agent");

        let raw: Value =
            serde_json::from_str(line).context("Failed to parse agent response as JSON")?;

        Ok(AgentResponse::from_json(&raw))
    }

    async fn ping_agent(&self) -> Result<()> {
        let mut stream =
            tokio::time::timeout(Duration::from_secs(3), async {
                TcpStream::connect(format!("127.0.0.1:{AGENT_HOST_PORT}")).await
            })
            .await
            .map_err(|_| anyhow!("Timed out connecting to agent"))?
            .context("Agent socket not reachable")?;

        // Send a simple ping
        let ping = r#"{"command":"ping"}"#;
        stream.write_all(ping.as_bytes()).await?;
        stream.write_all(b"\n").await?;
        stream.flush().await?;

        let mut reader = BufReader::new(&mut stream);
        let mut line = String::new();

        tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut line))
            .await
            .map_err(|_| anyhow!("Agent did not respond to ping"))??;

        debug!("Agent ping successful");
        Ok(())
    }

    async fn reconnect(&mut self, serial: &str) -> Result<()> {
        info!(serial, "Attempting to reconnect to agent");
        self.connected = false;

        // Re-establish port forwarding
        let _ = adb::remove_forward(serial, AGENT_HOST_PORT).await;
        adb::forward_port(serial, AGENT_HOST_PORT, AGENT_DEVICE_PORT).await?;

        match self.ping_agent().await {
            Ok(_) => {
                self.connected = true;
                info!("Reconnected to agent");
                Ok(())
            }
            Err(e) => {
                bail!("Failed to reconnect to agent: {e}");
            }
        }
    }
}

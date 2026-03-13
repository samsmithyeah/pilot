use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tonic::{Request, Response, Status};
use tracing::{error, info, instrument};
use uuid::Uuid;

use crate::adb;
use crate::agent_comms::{AgentCommand, AgentConnection, AgentResponse};
use crate::device::DeviceManager;
use crate::proto;
use crate::screenshot;

pub struct PilotServiceImpl {
    device_manager: Arc<RwLock<DeviceManager>>,
    agent: Arc<RwLock<AgentConnection>>,
}

impl PilotServiceImpl {
    pub fn new(
        device_manager: Arc<RwLock<DeviceManager>>,
        agent: Arc<RwLock<AgentConnection>>,
    ) -> Self {
        Self {
            device_manager,
            agent,
        }
    }

    fn request_id(provided: &str) -> String {
        if provided.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            provided.to_string()
        }
    }

    async fn active_serial(&self) -> Result<String, Status> {
        self.device_manager
            .write()
            .await
            .resolve_serial()
            .await
            .map_err(|e| Status::failed_precondition(e.to_string()))
    }

    async fn send_agent_command(&self, command: &AgentCommand) -> Result<AgentResponse, Status> {
        self.agent
            .write()
            .await
            .send_command(command)
            .await
            .map_err(|e| Status::internal(e.to_string()))
    }

    async fn send_agent_command_with_timeout(
        &self,
        command: &AgentCommand,
        timeout_ms: u64,
    ) -> Result<AgentResponse, Status> {
        let timeout = if timeout_ms > 0 {
            Duration::from_millis(timeout_ms)
        } else {
            Duration::from_secs(30)
        };

        self.agent
            .write()
            .await
            .send_command_with_timeout(command, timeout)
            .await
            .map_err(|e| Status::internal(e.to_string()))
    }

    async fn error_screenshot(&self) -> Vec<u8> {
        let serial = self.device_manager.read().await.active_serial().map(String::from);
        screenshot::capture_for_error(serial.as_deref()).await
    }

    async fn make_action_response(
        &self,
        request_id: String,
        result: Result<AgentResponse, Status>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        match result {
            Ok(resp) if resp.success => Ok(Response::new(proto::ActionResponse {
                request_id,
                success: true,
                error_type: String::new(),
                error_message: String::new(),
                screenshot: Vec::new(),
            })),
            Ok(resp) => {
                let screenshot = self.error_screenshot().await;
                Ok(Response::new(proto::ActionResponse {
                    request_id,
                    success: false,
                    error_type: resp.error_type.unwrap_or_default(),
                    error_message: resp.error.unwrap_or_else(|| "Unknown error".to_string()),
                    screenshot,
                }))
            }
            Err(status) => {
                let screenshot = self.error_screenshot().await;
                Ok(Response::new(proto::ActionResponse {
                    request_id,
                    success: false,
                    error_type: "INTERNAL".to_string(),
                    error_message: status.message().to_string(),
                    screenshot,
                }))
            }
        }
    }
}

/// Convert a protobuf Selector into a JSON value for the agent protocol.
fn selector_to_json(selector: &proto::Selector) -> Value {
    let mut obj = json!({});

    if let Some(ref sel) = selector.selector {
        match sel {
            proto::selector::Selector::Role(role_sel) => {
                obj["role"] = json!({
                    "role": role_sel.role,
                    "name": role_sel.name,
                });
            }
            proto::selector::Selector::Text(t) => {
                obj["text"] = json!(t);
            }
            proto::selector::Selector::TextContains(t) => {
                obj["textContains"] = json!(t);
            }
            proto::selector::Selector::ContentDesc(t) => {
                obj["contentDesc"] = json!(t);
            }
            proto::selector::Selector::Hint(t) => {
                obj["hint"] = json!(t);
            }
            proto::selector::Selector::ClassName(t) => {
                obj["className"] = json!(t);
            }
            proto::selector::Selector::TestId(t) => {
                obj["testId"] = json!(t);
            }
            proto::selector::Selector::ResourceId(t) => {
                obj["resourceId"] = json!(t);
            }
            proto::selector::Selector::Xpath(t) => {
                obj["xpath"] = json!(t);
            }
        }
    }

    if let Some(ref parent) = selector.parent {
        obj["parent"] = selector_to_json(parent);
    }

    obj
}

fn opt_timeout(ms: u64) -> Option<u64> {
    if ms > 0 { Some(ms) } else { None }
}

#[tonic::async_trait]
impl proto::pilot_service_server::PilotService for PilotServiceImpl {
    #[instrument(skip_all, fields(request_id))]
    async fn find_element(
        &self,
        request: Request<proto::FindElementRequest>,
    ) -> Result<Response<proto::FindElementResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::FindElement {
            selector: selector_to_json(selector),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;

        match result {
            Ok(resp) if resp.success => {
                let element = parse_element_info(&resp.data);
                Ok(Response::new(proto::FindElementResponse {
                    request_id,
                    found: true,
                    element,
                    error_message: String::new(),
                }))
            }
            Ok(resp) => Ok(Response::new(proto::FindElementResponse {
                request_id,
                found: false,
                element: None,
                error_message: resp.error.unwrap_or_else(|| "Element not found".to_string()),
            })),
            Err(status) => Ok(Response::new(proto::FindElementResponse {
                request_id,
                found: false,
                element: None,
                error_message: status.message().to_string(),
            })),
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn find_elements(
        &self,
        request: Request<proto::FindElementsRequest>,
    ) -> Result<Response<proto::FindElementsResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::FindElements {
            selector: selector_to_json(selector),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;

        match result {
            Ok(resp) if resp.success => {
                let elements = parse_element_list(&resp.data);
                Ok(Response::new(proto::FindElementsResponse {
                    request_id,
                    elements,
                    error_message: String::new(),
                }))
            }
            Ok(resp) => Ok(Response::new(proto::FindElementsResponse {
                request_id,
                elements: Vec::new(),
                error_message: resp.error.unwrap_or_default(),
            })),
            Err(status) => Ok(Response::new(proto::FindElementsResponse {
                request_id,
                elements: Vec::new(),
                error_message: status.message().to_string(),
            })),
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn tap(
        &self,
        request: Request<proto::TapRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::Tap {
            selector: selector_to_json(selector),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn long_press(
        &self,
        request: Request<proto::LongPressRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::LongPress {
            selector: selector_to_json(selector),
            duration_ms: opt_timeout(req.duration_ms),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn type_text(
        &self,
        request: Request<proto::TypeTextRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::TypeText {
            selector: selector_to_json(selector),
            text: req.text,
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn clear_text(
        &self,
        request: Request<proto::ClearTextRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let command = AgentCommand::ClearText {
            selector: selector_to_json(selector),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn clear_and_type(
        &self,
        request: Request<proto::ClearAndTypeRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let selector = req
            .selector
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("selector is required"))?;

        let sel_json = selector_to_json(selector);

        // Clear first, then type
        let clear_cmd = AgentCommand::ClearText {
            selector: sel_json.clone(),
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let clear_result = self
            .send_agent_command_with_timeout(&clear_cmd, req.timeout_ms)
            .await;

        if let Err(e) = &clear_result {
            return self
                .make_action_response(request_id, Err(e.clone()))
                .await;
        }

        if let Ok(ref resp) = clear_result {
            if !resp.success {
                return self.make_action_response(request_id, clear_result).await;
            }
        }

        let type_cmd = AgentCommand::TypeText {
            selector: sel_json,
            text: req.text,
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&type_cmd, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn swipe(
        &self,
        request: Request<proto::SwipeRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let start_element = req.start_element.as_ref().map(|s| selector_to_json(s));

        let command = AgentCommand::Swipe {
            direction: req.direction,
            start_element,
            speed: if req.speed > 0.0 { Some(req.speed) } else { None },
            distance: if req.distance > 0.0 {
                Some(req.distance)
            } else {
                None
            },
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn scroll(
        &self,
        request: Request<proto::ScrollRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let container = req.container.as_ref().map(|s| selector_to_json(s));
        let scroll_until_visible = req
            .scroll_until_visible
            .as_ref()
            .map(|s| selector_to_json(s));

        let command = AgentCommand::Scroll {
            container,
            direction: req.direction,
            scroll_until_visible,
            distance: if req.distance > 0.0 {
                Some(req.distance)
            } else {
                None
            },
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn press_key(
        &self,
        request: Request<proto::PressKeyRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let command = AgentCommand::PressKey { key: req.key };

        let result = self.send_agent_command(&command).await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn take_screenshot(
        &self,
        request: Request<proto::ScreenshotRequest>,
    ) -> Result<Response<proto::ScreenshotResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let serial = self.active_serial().await?;

        match screenshot::capture(&serial).await {
            Ok(data) => Ok(Response::new(proto::ScreenshotResponse {
                request_id,
                success: true,
                data,
                error_message: String::new(),
            })),
            Err(e) => Ok(Response::new(proto::ScreenshotResponse {
                request_id,
                success: false,
                data: Vec::new(),
                error_message: e.to_string(),
            })),
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn get_ui_hierarchy(
        &self,
        request: Request<proto::UiHierarchyRequest>,
    ) -> Result<Response<proto::UiHierarchyResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let command = AgentCommand::GetUiHierarchy {};

        match self.send_agent_command(&command).await {
            Ok(resp) if resp.success => {
                let xml = resp
                    .data
                    .get("hierarchy")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok(Response::new(proto::UiHierarchyResponse {
                    request_id,
                    hierarchy_xml: xml,
                    error_message: String::new(),
                }))
            }
            Ok(resp) => Ok(Response::new(proto::UiHierarchyResponse {
                request_id,
                hierarchy_xml: String::new(),
                error_message: resp.error.unwrap_or_default(),
            })),
            Err(status) => Ok(Response::new(proto::UiHierarchyResponse {
                request_id,
                hierarchy_xml: String::new(),
                error_message: status.message().to_string(),
            })),
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn wait_for_idle(
        &self,
        request: Request<proto::WaitForIdleRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let command = AgentCommand::WaitForIdle {
            timeout_ms: opt_timeout(req.timeout_ms),
        };

        let result = self
            .send_agent_command_with_timeout(&command, req.timeout_ms)
            .await;
        self.make_action_response(request_id, result).await
    }

    #[instrument(skip_all, fields(request_id))]
    async fn install_apk(
        &self,
        request: Request<proto::InstallApkRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let serial = self.active_serial().await?;

        info!(apk_path = %req.apk_path, "Installing APK");

        match adb::install_apk(&serial, &req.apk_path).await {
            Ok(()) => Ok(Response::new(proto::ActionResponse {
                request_id,
                success: true,
                error_type: String::new(),
                error_message: String::new(),
                screenshot: Vec::new(),
            })),
            Err(e) => {
                error!(error = %e, "APK installation failed");
                let screenshot = self.error_screenshot().await;
                Ok(Response::new(proto::ActionResponse {
                    request_id,
                    success: false,
                    error_type: "INSTALL_FAILED".to_string(),
                    error_message: e.to_string(),
                    screenshot,
                }))
            }
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn list_devices(
        &self,
        request: Request<proto::ListDevicesRequest>,
    ) -> Result<Response<proto::ListDevicesResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let mut dm = self.device_manager.write().await;
        dm.refresh()
            .await
            .map_err(|e| Status::internal(e.to_string()))?;

        let devices = dm
            .devices()
            .iter()
            .map(|d| proto::DeviceInfo {
                serial: d.serial.clone(),
                model: d.model.clone(),
                state: format!("{:?}", d.state),
                is_emulator: d.is_emulator,
            })
            .collect();

        Ok(Response::new(proto::ListDevicesResponse {
            request_id,
            devices,
        }))
    }

    #[instrument(skip_all, fields(request_id))]
    async fn set_device(
        &self,
        request: Request<proto::SetDeviceRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let mut dm = self.device_manager.write().await;

        // Refresh to make sure the device is known
        dm.refresh()
            .await
            .map_err(|e| Status::internal(e.to_string()))?;

        match dm.set_active(&req.serial) {
            Ok(()) => Ok(Response::new(proto::ActionResponse {
                request_id,
                success: true,
                error_type: String::new(),
                error_message: String::new(),
                screenshot: Vec::new(),
            })),
            Err(e) => Ok(Response::new(proto::ActionResponse {
                request_id,
                success: false,
                error_type: "DEVICE_NOT_FOUND".to_string(),
                error_message: e.to_string(),
                screenshot: Vec::new(),
            })),
        }
    }

    #[instrument(skip_all, fields(request_id))]
    async fn start_agent(
        &self,
        request: Request<proto::StartAgentRequest>,
    ) -> Result<Response<proto::ActionResponse>, Status> {
        let req = request.into_inner();
        let request_id = Self::request_id(&req.request_id);

        let serial = self.active_serial().await?;

        info!(serial = %serial, "Starting agent connection");

        // If a target package was specified, launch it via am instrument or similar
        if !req.target_package.is_empty() {
            let instrument_cmd = format!(
                "am instrument -w -e targetPackage {} com.pilot.agent/.PilotInstrumentation",
                req.target_package
            );

            // Launch instrumentation in the background on the device
            let bg_cmd = format!("nohup {} > /dev/null 2>&1 &", instrument_cmd);
            if let Err(e) = adb::shell(&serial, &bg_cmd).await {
                error!(error = %e, "Failed to start agent instrumentation");
                return Ok(Response::new(proto::ActionResponse {
                    request_id,
                    success: false,
                    error_type: "AGENT_START_FAILED".to_string(),
                    error_message: e.to_string(),
                    screenshot: Vec::new(),
                }));
            }

            // Give the agent a moment to start
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        // Connect to the agent
        let mut agent = self.agent.write().await;
        match agent.connect(&serial).await {
            Ok(()) => Ok(Response::new(proto::ActionResponse {
                request_id,
                success: true,
                error_type: String::new(),
                error_message: String::new(),
                screenshot: Vec::new(),
            })),
            Err(e) => {
                error!(error = %e, "Failed to connect to agent");
                let screenshot = screenshot::capture_for_error(Some(&serial)).await;
                Ok(Response::new(proto::ActionResponse {
                    request_id,
                    success: false,
                    error_type: "AGENT_CONNECTION_FAILED".to_string(),
                    error_message: e.to_string(),
                    screenshot,
                }))
            }
        }
    }

    async fn ping(
        &self,
        _request: Request<proto::PingRequest>,
    ) -> Result<Response<proto::PingResponse>, Status> {
        let agent_connected = self.agent.read().await.is_connected();

        Ok(Response::new(proto::PingResponse {
            version: env!("CARGO_PKG_VERSION").to_string(),
            agent_connected,
        }))
    }
}

// ─── Helper: Parse ElementInfo from agent JSON ───

fn parse_element_info(data: &Value) -> Option<proto::ElementInfo> {
    let el = if data.get("element").is_some() {
        data.get("element")?
    } else {
        data
    };

    Some(proto::ElementInfo {
        element_id: json_str(el, "elementId"),
        class_name: json_str(el, "className"),
        text: json_str(el, "text"),
        content_description: json_str(el, "contentDescription"),
        resource_id: json_str(el, "resourceId"),
        enabled: json_bool(el, "enabled"),
        visible: json_bool(el, "visible"),
        clickable: json_bool(el, "clickable"),
        focusable: json_bool(el, "focusable"),
        scrollable: json_bool(el, "scrollable"),
        bounds: parse_bounds(el.get("bounds")),
        hint: json_str(el, "hint"),
        checked: json_bool(el, "checked"),
        selected: json_bool(el, "selected"),
    })
}

fn parse_element_list(data: &Value) -> Vec<proto::ElementInfo> {
    let arr = data
        .get("elements")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    arr.iter().filter_map(|v| parse_element_info(v)).collect()
}

fn parse_bounds(value: Option<&Value>) -> Option<proto::Bounds> {
    let b = value?;
    Some(proto::Bounds {
        left: b.get("left").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        top: b.get("top").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        right: b.get("right").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        bottom: b.get("bottom").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
    })
}

fn json_str(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn json_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

use anyhow::{bail, Result};
use tracing::{debug, info};

use crate::adb;

/// Connection state of a tracked device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    /// Device detected but not yet selected.
    Discovered,
    /// Device is the active target.
    Active,
    /// Device was previously active but has disconnected.
    Disconnected,
}

/// Information about a connected Android device.
#[derive(Debug, Clone)]
pub struct DeviceInfo {
    pub serial: String,
    pub model: String,
    pub is_emulator: bool,
    pub state: ConnectionState,
}

/// Manages the set of known devices and tracks the active device.
#[derive(Debug)]
pub struct DeviceManager {
    devices: Vec<DeviceInfo>,
    active_serial: Option<String>,
}

impl DeviceManager {
    pub fn new() -> Self {
        Self {
            devices: Vec::new(),
            active_serial: None,
        }
    }

    /// Refresh the list of devices from ADB.
    pub async fn refresh(&mut self) -> Result<&[DeviceInfo]> {
        let adb_devices = adb::list_devices().await?;

        // Mark devices no longer present as disconnected
        for device in &mut self.devices {
            if !adb_devices.iter().any(|d| d.serial == device.serial && d.is_online()) {
                if device.state == ConnectionState::Active {
                    info!(serial = %device.serial, "Active device disconnected");
                }
                device.state = ConnectionState::Disconnected;
            }
        }

        // Add or update devices from ADB
        for adb_dev in &adb_devices {
            if !adb_dev.is_online() {
                continue;
            }

            if let Some(existing) = self.devices.iter_mut().find(|d| d.serial == adb_dev.serial) {
                if existing.state == ConnectionState::Disconnected {
                    existing.state = if self.active_serial.as_deref() == Some(&adb_dev.serial) {
                        ConnectionState::Active
                    } else {
                        ConnectionState::Discovered
                    };
                    debug!(serial = %existing.serial, "Device reconnected");
                }
            } else {
                let model = adb::get_device_model(&adb_dev.serial)
                    .await
                    .unwrap_or_else(|_| "unknown".to_string());

                self.devices.push(DeviceInfo {
                    serial: adb_dev.serial.clone(),
                    model,
                    is_emulator: adb_dev.is_emulator(),
                    state: ConnectionState::Discovered,
                });
                debug!(serial = %adb_dev.serial, "New device discovered");
            }
        }

        // Remove long-gone disconnected devices that aren't active
        self.devices.retain(|d| {
            d.state != ConnectionState::Disconnected
                || self.active_serial.as_deref() == Some(&d.serial)
        });

        Ok(&self.devices)
    }

    /// Set the active device by serial.
    pub fn set_active(&mut self, serial: &str) -> Result<()> {
        let device = self
            .devices
            .iter_mut()
            .find(|d| d.serial == serial)
            .or_else(|| None);

        match device {
            Some(_) => {
                // Deactivate the current device
                if let Some(ref prev) = self.active_serial {
                    if let Some(prev_dev) = self.devices.iter_mut().find(|d| &d.serial == prev) {
                        prev_dev.state = ConnectionState::Discovered;
                    }
                }

                self.active_serial = Some(serial.to_string());
                if let Some(dev) = self.devices.iter_mut().find(|d| d.serial == serial) {
                    dev.state = ConnectionState::Active;
                }
                info!(serial, "Device set as active");
                Ok(())
            }
            None => {
                bail!(
                    "Device {serial} not found. Run ListDevices first to refresh the device list."
                );
            }
        }
    }

    /// Get the serial of the active device, if any.
    pub fn active_serial(&self) -> Option<&str> {
        self.active_serial.as_deref()
    }

    /// Get the active device info.
    pub fn active_device(&self) -> Option<&DeviceInfo> {
        self.active_serial
            .as_ref()
            .and_then(|s| self.devices.iter().find(|d| &d.serial == s))
    }

    /// Get all known devices.
    pub fn devices(&self) -> &[DeviceInfo] {
        &self.devices
    }

    /// Resolve the device serial to use for an operation.
    /// Returns the active device serial, or if there's exactly one device, auto-selects it.
    pub async fn resolve_serial(&mut self) -> Result<String> {
        if let Some(serial) = &self.active_serial {
            return Ok(serial.clone());
        }

        self.refresh().await?;

        let online: Vec<_> = self
            .devices
            .iter()
            .filter(|d| d.state != ConnectionState::Disconnected)
            .collect();

        match online.len() {
            0 => bail!("No devices connected. Connect a device or start an emulator."),
            1 => {
                let serial = online[0].serial.clone();
                self.set_active(&serial)?;
                info!(serial = %serial, "Auto-selected the only connected device");
                Ok(serial)
            }
            n => {
                bail!(
                    "{n} devices connected but none selected. Use SetDevice to choose one."
                );
            }
        }
    }
}

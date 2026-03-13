use anyhow::Result;
use tracing::debug;

use crate::adb;

/// Capture a screenshot from the given device via ADB, returning PNG bytes.
pub async fn capture(serial: &str) -> Result<Vec<u8>> {
    debug!(serial, "Capturing screenshot via ADB");
    adb::screencap(serial).await
}

/// Attempt to capture a screenshot for inclusion in an error response.
/// Returns empty bytes if the capture fails (best-effort).
pub async fn capture_for_error(serial: Option<&str>) -> Vec<u8> {
    let Some(serial) = serial else {
        return Vec::new();
    };

    match capture(serial).await {
        Ok(png) => png,
        Err(e) => {
            debug!("Failed to capture error screenshot: {e}");
            Vec::new()
        }
    }
}

use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

static OFFSET_MS: OnceLock<i64> = OnceLock::new();

/// Sets a fixed offset, in milliseconds, applied to every subsequent call to [`now`].
///
/// Must be called at most once, before any call to [`now`].
#[allow(dead_code)]
pub(crate) fn set_offset_millis(offset_millis: i64) {
    OFFSET_MS
        .set(offset_millis)
        .expect("offset already set");
}

/// Returns the current time, adjusted by the configured offset, if any.
pub(crate) fn now() -> SystemTime {
    let mut now = SystemTime::now();
    if let Some(&offset_ms) = OFFSET_MS.get() {
        if offset_ms >= 0 {
            now += Duration::from_millis(offset_ms as u64);
        } else {
            now -= Duration::from_millis(-offset_ms as u64);
        }
    }
    return now;
}

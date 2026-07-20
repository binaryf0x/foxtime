use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

static OFFSET_MS: OnceLock<i64> = OnceLock::new();
static FREQ_PPM: OnceLock<f64> = OnceLock::new();
static DRIFT_START: OnceLock<SystemTime> = OnceLock::new();

/// Sets a fixed offset, in milliseconds, applied to every subsequent call to [`now`].
///
/// Must be called at most once, before any call to [`now`].
#[allow(dead_code)]
pub(crate) fn set_offset_millis(offset_millis: i64) {
    OFFSET_MS
        .set(offset_millis)
        .expect("offset already set");
}

/// Sets a clock drift, in parts-per-million, applied to every subsequent call to
/// [`now`]. A `freq_ppm` of 1 means that after 1 second of real time passes, `now`
/// will have advanced by 1.000001 seconds since this function was called; negative
/// values make the clock run slow instead.
///
/// Must be called at most once, before any call to [`now`].
#[allow(dead_code)]
pub(crate) fn set_freq_ppm(freq_ppm: f64) {
    DRIFT_START
        .set(SystemTime::now())
        .expect("freq ppm already set");
    FREQ_PPM
        .set(freq_ppm)
        .expect("freq ppm already set");
}

/// Returns the current time, adjusted by the configured drift and offset, if any.
pub(crate) fn now() -> SystemTime {
    let mut now = SystemTime::now();
    if let Some(&freq_ppm) = FREQ_PPM.get() {
        let start = *DRIFT_START.get().unwrap();
        if let Ok(elapsed) = now.duration_since(start) {
            let drift_micros = elapsed.as_secs_f64() * freq_ppm;
            if drift_micros >= 0.0 {
                now += Duration::from_micros(drift_micros as u64);
            } else {
                now -= Duration::from_micros(-drift_micros as u64);
            }
        }
    }
    if let Some(&offset_ms) = OFFSET_MS.get() {
        if offset_ms >= 0 {
            now += Duration::from_millis(offset_ms as u64);
        } else {
            now -= Duration::from_millis(-offset_ms as u64);
        }
    }
    return now;
}

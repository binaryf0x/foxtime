use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

/// Simulated clock errors applied to every call to [`now`]: a fixed offset and/or
/// a frequency drift relative to the true system clock.
struct ClockErrors {
    offset_millis: i64,
    freq_ppm: f64,
    drift_start: SystemTime,
}

static ERRORS: OnceLock<ClockErrors> = OnceLock::new();

/// Sets the simulated clock errors applied to every subsequent call to [`now`]:
/// a fixed `offset_millis`, in milliseconds, and a clock drift of `freq_ppm`,
/// in parts-per-million. A `freq_ppm` of 1 means that after 1 second of real
/// time passes, `now` will have advanced by 1.000001 seconds since this
/// function was called; negative values make the clock run slow instead.
///
/// If both `offset_millis` and `freq_ppm` are zero, no errors are simulated.
///
/// Must be called at most once, before any call to [`now`].
#[allow(dead_code)]
pub(crate) fn set_errors(offset_millis: i64, freq_ppm: f64) {
    if offset_millis != 0 || freq_ppm != 0.0 {
        ERRORS
            .set(ClockErrors {
                offset_millis,
                freq_ppm,
                drift_start: SystemTime::now(),
            })
            .unwrap_or_else(|_| panic!("errors already set"));
    }
}

/// Returns the current time, adjusted by the configured drift and offset, if any.
pub(crate) fn now() -> SystemTime {
    let mut now = SystemTime::now();
    if let Some(errors) = ERRORS.get() {
        if let Ok(elapsed) = now.duration_since(errors.drift_start) {
            let drift_micros = elapsed.as_secs_f64() * errors.freq_ppm;
            if drift_micros >= 0.0 {
                now += Duration::from_micros(drift_micros as u64);
            } else {
                now -= Duration::from_micros(-drift_micros as u64);
            }
        }
        if errors.offset_millis >= 0 {
            now += Duration::from_millis(errors.offset_millis as u64);
        } else {
            now -= Duration::from_millis(-errors.offset_millis as u64);
        }
    }
    now
}

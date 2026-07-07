use chrono::{DateTime, SecondsFormat, Utc};
use chrono_tz::Tz;

use crate::{Result, SchedulerError, ValidationError};

pub fn now_rfc3339() -> String {
    format_utc_rfc3339(Utc::now())
}

pub fn format_utc_rfc3339(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn parse_utc_rfc3339(value: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
}

pub fn validate_timezone(name: &str) -> Result<Tz> {
    name.parse::<Tz>()
        .map_err(|_| SchedulerError::Validation(ValidationError::InvalidTimezone(name.to_owned())))
}

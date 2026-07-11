use std::str::FromStr;

use chrono::{DateTime, Duration, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use croner::parser::{CronParser, Seconds, Year};
use croner::Cron;

use crate::model::{MissedPolicy, OverlapPolicy, Task, TaskKind};
use crate::time;

pub const DEFAULT_MISSED_WINDOW_DAYS: i64 = 7;
pub const DEFAULT_MAX_CATCHUP_RUNS: usize = 5;

const MAX_CRON_SEARCH_MINUTES: usize = 366 * 24 * 60;
const MAX_MISSED_OCCURRENCES: usize = 100_000;

pub type Result<T> = std::result::Result<T, ScheduleError>;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScheduleError {
    #[error("cron expression must have exactly 5 fields; found 0")]
    EmptyCron,

    #[error("cron expression must have exactly 5 fields; found {found}")]
    InvalidCronFieldCount { found: usize },

    #[error("cron expression must have exactly 5 fields; found 6, seconds are not supported")]
    SecondsFieldNotSupported,

    #[error("invalid cron expression `{expr}`: {message}")]
    InvalidCron { expr: String, message: String },

    #[error("invalid timezone: {0}")]
    InvalidTimezone(String),

    #[error("invalid RFC3339 timestamp `{value}`: {message}")]
    InvalidRfc3339 { value: String, message: String },

    #[error("kind='once' requires run_at")]
    MissingRunAt,

    #[error("kind='cron' requires cron_expr")]
    MissingCronExpr,

    #[error("unable to find a matching cron occurrence")]
    OccurrenceSearchExhausted,

    #[error("missed occurrence scan exceeded {limit} occurrences")]
    MissedOccurrenceLimitExceeded { limit: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CronSchedule {
    expr: String,
    cron: Cron,
}

impl CronSchedule {
    pub fn expression(&self) -> &str {
        &self.expr
    }

    pub fn next_after(&self, timezone: Tz, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
        next_cron_after(self, timezone, after)
    }

    pub fn next_at_or_after(
        &self,
        timezone: Tz,
        at_or_after: DateTime<Utc>,
    ) -> Result<DateTime<Utc>> {
        if self.matches_utc(timezone, at_or_after)? {
            return Ok(at_or_after);
        }
        self.next_after(timezone, at_or_after)
    }

    pub fn preview(
        &self,
        timezone: Tz,
        from: DateTime<Utc>,
        count: usize,
    ) -> Result<Vec<DateTime<Utc>>> {
        preview_cron(self, timezone, from, count)
    }

    pub fn matches_utc(&self, timezone: Tz, at: DateTime<Utc>) -> Result<bool> {
        if is_second_ambiguous_occurrence(timezone, at) {
            return Ok(false);
        }

        let Some(before) = at.checked_sub_signed(Duration::seconds(1)) else {
            return Ok(false);
        };
        Ok(self.next_after(timezone, before)? == at)
    }
}

impl FromStr for CronSchedule {
    type Err = ScheduleError;

    fn from_str(expr: &str) -> Result<Self> {
        validate_cron(expr)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissedRunCursor {
    LastScheduledFor(DateTime<Utc>),
    PreviousNextRunAt(DateTime<Utc>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MissedRunOptions {
    pub max_catchup_runs: usize,
}

impl Default for MissedRunOptions {
    fn default() -> Self {
        Self {
            max_catchup_runs: DEFAULT_MAX_CATCHUP_RUNS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissedRunSelection {
    pub enqueue: Vec<DateTime<Utc>>,
    pub skipped: Vec<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlapDecision {
    Start,
    Skip { reason: OverlapSkipReason },
    Queue,
    CancelPrevious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlapSkipReason {
    PreviousRunStillRunning,
}

impl OverlapSkipReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PreviousRunStillRunning => "previous_run_still_running",
        }
    }
}

pub fn validate_cron(expr: &str) -> Result<CronSchedule> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err(ScheduleError::EmptyCron);
    }

    let field_count = trimmed.split_whitespace().count();
    if field_count == 6 {
        return Err(ScheduleError::SecondsFieldNotSupported);
    }
    if field_count != 5 {
        return Err(ScheduleError::InvalidCronFieldCount { found: field_count });
    }
    validate_standard_cron_characters(trimmed)?;

    let parser = CronParser::builder()
        .seconds(Seconds::Disallowed)
        .year(Year::Disallowed)
        .build();
    let cron = parser
        .parse(trimmed)
        .map_err(|err| ScheduleError::InvalidCron {
            expr: trimmed.to_owned(),
            message: err.to_string(),
        })?;

    Ok(CronSchedule {
        expr: trimmed.to_owned(),
        cron,
    })
}

pub fn parse_rfc3339_utc(value: &str) -> Result<DateTime<Utc>> {
    time::parse_utc_rfc3339(value).map_err(|err| ScheduleError::InvalidRfc3339 {
        value: value.to_owned(),
        message: err.to_string(),
    })
}

pub fn validate_iana_timezone(name: &str) -> Result<Tz> {
    time::validate_timezone(name).map_err(|_| ScheduleError::InvalidTimezone(name.to_owned()))
}

pub fn compute_next_run_at(task: &Task, now: DateTime<Utc>) -> Result<Option<DateTime<Utc>>> {
    match task.kind {
        TaskKind::Manual => Ok(None),
        TaskKind::Once => task
            .run_at
            .as_deref()
            .ok_or(ScheduleError::MissingRunAt)
            .and_then(parse_rfc3339_utc)
            .map(Some),
        TaskKind::Cron => {
            let expr = task
                .cron_expr
                .as_deref()
                .ok_or(ScheduleError::MissingCronExpr)?;
            let schedule = validate_cron(expr)?;
            let timezone = validate_iana_timezone(&task.timezone)?;
            schedule.next_after(timezone, now).map(Some)
        }
    }
}

pub fn preview_next_run_times(
    task: &Task,
    from: DateTime<Utc>,
    count: usize,
) -> Result<Vec<DateTime<Utc>>> {
    if count == 0 {
        return Ok(Vec::new());
    }

    match task.kind {
        TaskKind::Manual => Ok(Vec::new()),
        TaskKind::Once => task
            .run_at
            .as_deref()
            .ok_or(ScheduleError::MissingRunAt)
            .and_then(parse_rfc3339_utc)
            .map(|run_at| vec![run_at]),
        TaskKind::Cron => {
            let expr = task
                .cron_expr
                .as_deref()
                .ok_or(ScheduleError::MissingCronExpr)?;
            let schedule = validate_cron(expr)?;
            let timezone = validate_iana_timezone(&task.timezone)?;
            schedule.preview(timezone, from, count)
        }
    }
}

pub fn preview_cron(
    schedule: &CronSchedule,
    timezone: Tz,
    from: DateTime<Utc>,
    count: usize,
) -> Result<Vec<DateTime<Utc>>> {
    let mut times = Vec::with_capacity(count);
    let mut cursor = from;

    for _ in 0..count {
        let next = schedule.next_after(timezone, cursor)?;
        times.push(next);
        cursor = next;
    }

    Ok(times)
}

pub fn select_missed_runs(
    task: &Task,
    cursor: Option<MissedRunCursor>,
    now: DateTime<Utc>,
    options: MissedRunOptions,
) -> Result<MissedRunSelection> {
    let next_run_at = compute_next_run_at(task, now)?;

    if task.kind != TaskKind::Cron {
        return Ok(MissedRunSelection {
            enqueue: Vec::new(),
            skipped: Vec::new(),
            next_run_at,
        });
    }

    if task.missed_policy == MissedPolicy::Skip {
        return Ok(MissedRunSelection {
            enqueue: Vec::new(),
            skipped: Vec::new(),
            next_run_at,
        });
    }

    let Some(cursor) = cursor else {
        return Ok(MissedRunSelection {
            enqueue: Vec::new(),
            skipped: Vec::new(),
            next_run_at,
        });
    };

    let expr = task
        .cron_expr
        .as_deref()
        .ok_or(ScheduleError::MissingCronExpr)?;
    let schedule = validate_cron(expr)?;
    let timezone = validate_iana_timezone(&task.timezone)?;
    let missed = missed_occurrences(&schedule, timezone, cursor, now)?;

    match task.missed_policy {
        MissedPolicy::Skip => unreachable!("skip policy returned before cron scan"),
        MissedPolicy::LatestWithinWindow => {
            let window_days = if task.missed_window_days > 0 {
                task.missed_window_days
            } else {
                DEFAULT_MISSED_WINDOW_DAYS
            };
            let window_start = now - Duration::days(window_days);
            let latest = missed
                .iter()
                .copied()
                .filter(|occurrence| *occurrence >= window_start)
                .next_back();

            let mut enqueue = Vec::new();
            let mut skipped = missed;
            if let Some(latest) = latest {
                enqueue.push(latest);
                skipped.retain(|occurrence| *occurrence != latest);
            }

            Ok(MissedRunSelection {
                enqueue,
                skipped,
                next_run_at,
            })
        }
        MissedPolicy::RunAllCapped => {
            let cap = options.max_catchup_runs;
            let split_at = missed.len().min(cap);
            let enqueue = missed[..split_at].to_vec();
            let skipped = missed[split_at..].to_vec();

            Ok(MissedRunSelection {
                enqueue,
                skipped,
                next_run_at,
            })
        }
    }
}

pub fn decide_overlap(policy: OverlapPolicy, previous_run_running: bool) -> OverlapDecision {
    if !previous_run_running {
        return OverlapDecision::Start;
    }

    match policy {
        OverlapPolicy::Skip => OverlapDecision::Skip {
            reason: OverlapSkipReason::PreviousRunStillRunning,
        },
        OverlapPolicy::Queue => OverlapDecision::Queue,
        OverlapPolicy::CancelPrevious => OverlapDecision::CancelPrevious,
    }
}

fn next_cron_after(
    schedule: &CronSchedule,
    timezone: Tz,
    after: DateTime<Utc>,
) -> Result<DateTime<Utc>> {
    let mut cursor = after;
    let after_local_wall_clock = after.with_timezone(&timezone).naive_local();

    for _ in 0..MAX_CRON_SEARCH_MINUTES {
        let local_cursor = cursor.with_timezone(&timezone);
        let candidate = schedule
            .cron
            .find_next_occurrence(&local_cursor, false)
            .map_err(|err| ScheduleError::InvalidCron {
                expr: schedule.expr.clone(),
                message: err.to_string(),
            })?
            .with_timezone(&Utc)
            .with_nanosecond(0)
            .ok_or(ScheduleError::OccurrenceSearchExhausted)?;
        let candidate_local_wall_clock = candidate.with_timezone(&timezone).naive_local();

        if candidate > after
            && candidate > cursor
            && candidate_local_wall_clock > after_local_wall_clock
            && !is_second_ambiguous_occurrence(timezone, candidate)
        {
            return Ok(candidate);
        }

        cursor = cursor
            .checked_add_signed(Duration::minutes(1))
            .ok_or(ScheduleError::OccurrenceSearchExhausted)?;
    }

    Err(ScheduleError::OccurrenceSearchExhausted)
}

fn missed_occurrences(
    schedule: &CronSchedule,
    timezone: Tz,
    cursor: MissedRunCursor,
    now: DateTime<Utc>,
) -> Result<Vec<DateTime<Utc>>> {
    let (mut next, inclusive) = match cursor {
        MissedRunCursor::LastScheduledFor(previous) => (previous, false),
        MissedRunCursor::PreviousNextRunAt(previous) => (previous, true),
    };

    if next > now {
        return Ok(Vec::new());
    }

    let mut missed = Vec::new();

    if inclusive && schedule.matches_utc(timezone, next)? {
        push_missed_occurrence(&mut missed, next)?;
    }

    loop {
        next = schedule.next_after(timezone, next)?;
        if next > now {
            break;
        }
        push_missed_occurrence(&mut missed, next)?;
    }

    Ok(missed)
}

fn push_missed_occurrence(
    missed: &mut Vec<DateTime<Utc>>,
    occurrence: DateTime<Utc>,
) -> Result<()> {
    if missed.len() >= MAX_MISSED_OCCURRENCES {
        return Err(ScheduleError::MissedOccurrenceLimitExceeded {
            limit: MAX_MISSED_OCCURRENCES,
        });
    }

    missed.push(occurrence);
    Ok(())
}

fn validate_standard_cron_characters(expr: &str) -> Result<()> {
    let fields = expr.split_whitespace().collect::<Vec<_>>();
    for (index, field) in fields.iter().enumerate() {
        for ch in field.chars() {
            let is_valid = ch.is_ascii_digit()
                || ch.is_ascii_alphabetic()
                || matches!(ch, '*' | ',' | '-' | '/');
            if !is_valid {
                return Err(ScheduleError::InvalidCron {
                    expr: expr.to_owned(),
                    message: format!("unsupported character `{ch}`"),
                });
            }
        }

        validate_alpha_tokens(expr, index, field)?;
    }

    Ok(())
}

fn validate_alpha_tokens(expr: &str, field_index: usize, field: &str) -> Result<()> {
    const MONTH_NAMES: &[&str] = &[
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ];
    const WEEKDAY_NAMES: &[&str] = &["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    let valid_names = match field_index {
        3 => Some(MONTH_NAMES),
        4 => Some(WEEKDAY_NAMES),
        _ => None,
    };

    for token in field.split([',', '-', '/']) {
        if !token.chars().any(|ch| ch.is_ascii_alphabetic()) {
            continue;
        }

        let Some(valid_names) = valid_names else {
            return Err(ScheduleError::InvalidCron {
                expr: expr.to_owned(),
                message: format!("unsupported name `{token}`"),
            });
        };

        let token = token.to_ascii_uppercase();
        if !valid_names.contains(&token.as_str()) {
            return Err(ScheduleError::InvalidCron {
                expr: expr.to_owned(),
                message: format!("unsupported name `{token}`"),
            });
        }
    }

    Ok(())
}

fn is_second_ambiguous_occurrence(timezone: Tz, at: DateTime<Utc>) -> bool {
    let local = at.with_timezone(&timezone);
    match timezone.from_local_datetime(&local.naive_local()) {
        chrono::LocalResult::Ambiguous(_, second) => second.with_timezone(&Utc) == at,
        chrono::LocalResult::Single(_) | chrono::LocalResult::None => false,
    }
}

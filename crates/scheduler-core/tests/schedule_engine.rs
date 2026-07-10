use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use scheduler_core::model::*;
use scheduler_core::schedule::*;

fn dt(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("valid RFC3339")
        .with_timezone(&Utc)
}

fn tz(name: &str) -> Tz {
    name.parse::<Tz>().expect("valid timezone")
}

fn sample_task(kind: TaskKind, cron_expr: Option<&str>, run_at: Option<&str>) -> Task {
    let now = "2026-07-07T00:00:00Z".to_owned();
    Task {
        id: "task_01900000-0000-7000-8000-000000000000".to_owned(),
        slug: "sample-task".to_owned(),
        name: "Sample Task".to_owned(),
        status: TaskStatus::Active,
        locked: false,
        kind,
        cron_expr: cron_expr.map(str::to_owned),
        run_at: run_at.map(str::to_owned),
        timezone: "UTC".to_owned(),
        next_run_at: None,
        last_scheduled_for: None,
        schedule_status: ScheduleStatus::Valid,
        schedule_error: None,
        prompt_body: "Check status.".to_owned(),
        prompt_hash: "hash".to_owned(),
        inject_scheduler_instructions: true,
        target_mode: RunTargetMode::Chat,
        project_id: None,
        repo_path: None,
        base_ref: None,
        model: None,
        reasoning_effort: None,
        sandbox_mode: SandboxMode::ReadOnly,
        approval_policy: ApprovalPolicy::Never,
        allow_schedule_cli: true,
        schedule_cli_capabilities: "[]".to_owned(),
        max_created_schedules_per_run: 5,
        missed_policy: MissedPolicy::LatestWithinWindow,
        missed_window_days: 7,
        overlap_policy: OverlapPolicy::Skip,
        max_runtime_sec: 7_200,
        max_retries: 0,
        retry_backoff_sec: 300,
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
        created_by: "user".to_owned(),
        created_by_run_id: None,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    }
}

#[test]
fn cron_next_every_minute_and_common_examples() {
    let utc = tz("UTC");
    let tokyo = tz("Asia/Tokyo");

    let every_minute = validate_cron("* * * * *").expect("valid cron");
    assert_eq!(
        every_minute
            .next_after(utc, dt("2026-07-07T12:00:30Z"))
            .expect("next"),
        dt("2026-07-07T12:01:00Z")
    );

    let every_fifteen = validate_cron("*/15 * * * *").expect("valid cron");
    assert_eq!(
        every_fifteen
            .next_after(tokyo, dt("2026-07-07T03:01:00Z"))
            .expect("next"),
        dt("2026-07-07T03:15:00Z")
    );

    let weekdays_9 = validate_cron("0 9 * * 1-5").expect("valid cron");
    assert_eq!(
        weekdays_9
            .next_after(tokyo, dt("2026-07-10T00:01:00Z"))
            .expect("next"),
        dt("2026-07-13T00:00:00Z")
    );

    let first_day_10 = validate_cron("0 10 1 * *").expect("valid cron");
    assert_eq!(
        first_day_10
            .next_after(tokyo, dt("2026-07-01T00:00:00Z"))
            .expect("next"),
        dt("2026-07-01T01:00:00Z")
    );
}

#[test]
fn validate_cron_rejects_seconds_and_invalid_expressions() {
    assert!(matches!(
        validate_cron("0 */15 * * * *"),
        Err(ScheduleError::SecondsFieldNotSupported)
    ));

    assert!(matches!(
        validate_cron("60 * * * *"),
        Err(ScheduleError::InvalidCron { .. })
    ));

    assert!(matches!(
        validate_cron("@daily"),
        Err(ScheduleError::InvalidCronFieldCount { found: 1 })
    ));

    assert!(matches!(
        validate_cron("0 0 1 * +MON"),
        Err(ScheduleError::InvalidCron { .. })
    ));
}

#[test]
fn cron_dom_and_dow_use_standard_or_semantics() {
    let utc = tz("UTC");
    let schedule = validate_cron("0 0 1 * 1").expect("valid cron");

    assert_eq!(
        schedule
            .next_after(utc, dt("2026-06-30T23:00:00Z"))
            .expect("next"),
        dt("2026-07-01T00:00:00Z")
    );
    assert_eq!(
        schedule
            .next_after(utc, dt("2026-07-01T00:00:00Z"))
            .expect("next"),
        dt("2026-07-06T00:00:00Z")
    );
}

#[test]
fn cron_spring_forward_nonexistent_local_time_rolls_forward() {
    let new_york = tz("America/New_York");
    let schedule = validate_cron("30 2 * * *").expect("valid cron");

    assert_eq!(
        schedule
            .next_after(new_york, dt("2026-03-08T05:00:00Z"))
            .expect("next"),
        dt("2026-03-08T07:00:00Z")
    );
}

#[test]
fn cron_fall_back_ambiguous_local_time_uses_first_occurrence_only() {
    let new_york = tz("America/New_York");
    let schedule = validate_cron("30 1 * * *").expect("valid cron");

    let preview = schedule
        .preview(new_york, dt("2026-11-01T04:00:00Z"), 2)
        .expect("preview");

    assert_eq!(
        preview,
        vec![dt("2026-11-01T05:30:00Z"), dt("2026-11-02T06:30:00Z")]
    );
}

#[test]
fn cron_fall_back_every_minute_skips_repeated_wall_clock_hour() {
    let new_york = tz("America/New_York");
    let schedule = validate_cron("* * * * *").expect("valid cron");

    let preview = schedule
        .preview(new_york, dt("2026-11-01T05:57:00Z"), 5)
        .expect("preview");

    assert_eq!(
        preview,
        vec![
            dt("2026-11-01T05:58:00Z"),
            dt("2026-11-01T05:59:00Z"),
            dt("2026-11-01T07:00:00Z"),
            dt("2026-11-01T07:01:00Z"),
            dt("2026-11-01T07:02:00Z"),
        ]
    );
}

#[test]
fn cron_fall_back_fifteen_minute_interval_skips_repeated_wall_clock_hour() {
    let new_york = tz("America/New_York");
    let schedule = validate_cron("*/15 * * * *").expect("valid cron");

    let preview = schedule
        .preview(new_york, dt("2026-11-01T05:30:00Z"), 4)
        .expect("preview");

    assert_eq!(
        preview,
        vec![
            dt("2026-11-01T05:45:00Z"),
            dt("2026-11-01T07:00:00Z"),
            dt("2026-11-01T07:15:00Z"),
            dt("2026-11-01T07:30:00Z"),
        ]
    );
}

#[test]
fn compute_next_run_at_handles_manual_once_and_cron() {
    let manual = sample_task(TaskKind::Manual, None, None);
    assert_eq!(
        compute_next_run_at(&manual, dt("2026-07-07T00:00:00Z")).expect("next"),
        None
    );

    let once = sample_task(TaskKind::Once, None, Some("2026-07-01T00:00:00Z"));
    assert_eq!(
        compute_next_run_at(&once, dt("2026-07-07T00:00:00Z")).expect("next"),
        Some(dt("2026-07-01T00:00:00Z"))
    );

    let cron = sample_task(TaskKind::Cron, Some("*/15 * * * *"), None);
    assert_eq!(
        compute_next_run_at(&cron, dt("2026-07-07T00:01:00Z")).expect("next"),
        Some(dt("2026-07-07T00:15:00Z"))
    );
}

#[test]
fn preview_next_run_times_returns_requested_count() {
    let task = sample_task(TaskKind::Cron, Some("*/15 * * * *"), None);
    let preview = preview_next_run_times(&task, dt("2026-07-07T00:01:00Z"), 5).expect("preview");

    assert_eq!(
        preview,
        vec![
            dt("2026-07-07T00:15:00Z"),
            dt("2026-07-07T00:30:00Z"),
            dt("2026-07-07T00:45:00Z"),
            dt("2026-07-07T01:00:00Z"),
            dt("2026-07-07T01:15:00Z"),
        ]
    );
}

#[test]
fn missed_policy_skip_does_not_report_catchup_or_skipped_runs() {
    let mut task = sample_task(TaskKind::Cron, Some("0 * * * *"), None);
    task.missed_policy = MissedPolicy::Skip;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::LastScheduledFor(dt(
            "2026-07-07T00:00:00Z",
        ))),
        dt("2026-07-07T05:30:00Z"),
        MissedRunOptions::default(),
    )
    .expect("missed selection");

    assert!(selection.enqueue.is_empty());
    assert!(selection.skipped.is_empty());
    assert_eq!(selection.next_run_at, Some(dt("2026-07-07T06:00:00Z")));
}

#[test]
fn missed_policy_latest_within_window_reports_latest_and_skips_older_runs() {
    let mut task = sample_task(TaskKind::Cron, Some("0 0 * * *"), None);
    task.missed_policy = MissedPolicy::LatestWithinWindow;
    task.missed_window_days = 1;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::LastScheduledFor(dt(
            "2026-07-01T00:00:00Z",
        ))),
        dt("2026-07-04T00:00:00Z"),
        MissedRunOptions::default(),
    )
    .expect("missed selection");

    assert_eq!(selection.enqueue, vec![dt("2026-07-04T00:00:00Z")]);
    assert_eq!(
        selection.skipped,
        vec![dt("2026-07-02T00:00:00Z"), dt("2026-07-03T00:00:00Z")]
    );
    assert_eq!(selection.next_run_at, Some(dt("2026-07-05T00:00:00Z")));
}

#[test]
fn missed_policy_latest_within_window_includes_lower_boundary() {
    let mut task = sample_task(TaskKind::Cron, Some("0 0 * * *"), None);
    task.missed_policy = MissedPolicy::LatestWithinWindow;
    task.missed_window_days = 1;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::LastScheduledFor(dt(
            "2026-07-01T00:00:00Z",
        ))),
        dt("2026-07-02T00:00:00Z"),
        MissedRunOptions::default(),
    )
    .expect("missed selection");

    assert_eq!(selection.enqueue, vec![dt("2026-07-02T00:00:00Z")]);
    assert!(selection.skipped.is_empty());
}

#[test]
fn missed_policy_previous_next_run_at_includes_spring_forward_roll_forward_occurrence() {
    let mut task = sample_task(TaskKind::Cron, Some("30 2 * * *"), None);
    task.timezone = "America/New_York".to_owned();
    task.missed_policy = MissedPolicy::LatestWithinWindow;
    task.missed_window_days = 1;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::PreviousNextRunAt(dt(
            "2026-03-08T07:00:00Z",
        ))),
        dt("2026-03-08T07:30:00Z"),
        MissedRunOptions::default(),
    )
    .expect("missed selection");

    assert_eq!(selection.enqueue, vec![dt("2026-03-08T07:00:00Z")]);
    assert!(selection.skipped.is_empty());
    assert_eq!(selection.next_run_at, Some(dt("2026-03-09T06:30:00Z")));
}

#[test]
fn missed_policy_run_all_capped_enqueues_oldest_runs_up_to_cap() {
    let mut task = sample_task(TaskKind::Cron, Some("0 0 * * *"), None);
    task.missed_policy = MissedPolicy::RunAllCapped;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::LastScheduledFor(dt(
            "2026-07-01T00:00:00Z",
        ))),
        dt("2026-07-06T00:00:00Z"),
        MissedRunOptions {
            max_catchup_runs: 3,
        },
    )
    .expect("missed selection");

    assert_eq!(
        selection.enqueue,
        vec![
            dt("2026-07-02T00:00:00Z"),
            dt("2026-07-03T00:00:00Z"),
            dt("2026-07-04T00:00:00Z"),
        ]
    );
    assert_eq!(
        selection.skipped,
        vec![dt("2026-07-05T00:00:00Z"), dt("2026-07-06T00:00:00Z")]
    );
}

#[test]
fn missed_policy_run_all_capped_exact_cap_has_no_skipped_runs() {
    let mut task = sample_task(TaskKind::Cron, Some("0 0 * * *"), None);
    task.missed_policy = MissedPolicy::RunAllCapped;

    let selection = select_missed_runs(
        &task,
        Some(MissedRunCursor::LastScheduledFor(dt(
            "2026-07-01T00:00:00Z",
        ))),
        dt("2026-07-04T00:00:00Z"),
        MissedRunOptions {
            max_catchup_runs: 3,
        },
    )
    .expect("missed selection");

    assert_eq!(
        selection.enqueue,
        vec![
            dt("2026-07-02T00:00:00Z"),
            dt("2026-07-03T00:00:00Z"),
            dt("2026-07-04T00:00:00Z"),
        ]
    );
    assert!(selection.skipped.is_empty());
}

#[test]
fn overlap_policy_decisions_reflect_running_state() {
    assert_eq!(
        decide_overlap(OverlapPolicy::Skip, false),
        OverlapDecision::Start
    );
    assert_eq!(
        decide_overlap(OverlapPolicy::Skip, true),
        OverlapDecision::Skip {
            reason: OverlapSkipReason::PreviousRunStillRunning
        }
    );
    assert_eq!(
        decide_overlap(OverlapPolicy::Queue, true),
        OverlapDecision::Queue
    );
    assert_eq!(
        decide_overlap(OverlapPolicy::CancelPrevious, true),
        OverlapDecision::CancelPrevious
    );
}

#[test]
fn retry_backoff_uses_attempt_multiplier_and_honors_max_retries() {
    let failed_at = dt("2026-07-07T00:00:00Z");

    assert_eq!(
        next_retry_at(failed_at, 300, 2).expect("retry at"),
        dt("2026-07-07T00:10:00Z")
    );

    assert_eq!(
        retry_decision(2, 300, 2, failed_at).expect("decision"),
        RetryDecision {
            should_retry: true,
            next_attempt: Some(3),
            retry_at: Some(dt("2026-07-07T00:10:00Z")),
        }
    );

    assert_eq!(
        retry_decision(2, 300, 3, failed_at).expect("decision"),
        RetryDecision {
            should_retry: false,
            next_attempt: None,
            retry_at: None,
        }
    );
}

#[test]
fn validation_helpers_parse_rfc3339_and_timezone() {
    assert_eq!(
        parse_rfc3339_utc("2026-07-07T09:00:00+09:00").expect("parse"),
        dt("2026-07-07T00:00:00Z")
    );
    assert_eq!(
        validate_iana_timezone("Asia/Tokyo").expect("timezone"),
        tz("Asia/Tokyo")
    );
    assert!(matches!(
        validate_iana_timezone("Not/AZone"),
        Err(ScheduleError::InvalidTimezone(value)) if value == "Not/AZone"
    ));
}

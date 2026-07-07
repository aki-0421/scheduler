# UI/UX 仕様

## 1. UI 方針

- Tauri window 内で Next.js static app を表示する。
- shadcn/ui の primitives を利用し、デスクトップアプリとして軽量で密度の高い UI にする。
- 重要操作は keyboard friendly にする。
- 危険な権限や local working tree 直接変更は明確に warning を表示する。

## 2. 画面構成

```text
Sidebar
  Dashboard
  Tasks
  Runs / Triage
  Projects
  Settings

Main pane
  List / Detail / Wizard
```

## 3. Dashboard

表示項目:

- Scheduler status: Running / Paused / Error。
- Next 10 runs。
- Running now。
- Failed runs in last 24h。
- Tasks requiring review。
- Codex CLI health。

Actions:

- New Task。
- Run due check now。
- Pause all schedules。
- Open diagnostics。

shadcn/ui components:

- `Card`
- `Badge`
- `Button`
- `Table`
- `Alert`
- `Progress`

## 4. Task list

Columns:

| column | 内容 |
| --- | --- |
| Status | active / paused / completed / invalid |
| Name | task name + description |
| Schedule | once / cron / manual summary |
| Next run | localized datetime |
| Target | chat / repo-local / worktree |
| Last result | succeeded / failed / skipped |
| Actions | run now / pause / edit / menu |

Filters:

- status。
- target mode。
- project。
- schedule kind。
- failed only。

## 5. New/Edit Task wizard

### Step 1: Basics

Fields:

- Name。
- Description。
- Prompt。
- Inject scheduler CLI instructions: toggle。

Prompt editor:

- monospace textarea。
- prompt file import optional。
- character count。

### Step 2: Target

Options:

1. Chat only。
2. Repository: local working tree。
3. Repository: isolated worktree。

Repository picker:

- Select folder。
- Trust folder prompt。
- Git status preview。
- default branch detection。

Warnings:

- local working tree: 「未コミット変更を Codex が変更する可能性があります」
- danger-full-access: 「sandbox と承認を迂回するため、隔離環境以外では非推奨です」

### Step 3: Schedule

Tabs:

- Manual。
- Once。
- Preset。
- Cron。

Once fields:

- date。
- time。
- timezone。

Preset fields:

- hourly。
- daily at time。
- weekdays at time。
- weekly day/time。

Cron fields:

- cron expression。
- timezone。
- next 5 times preview。
- validation error。

Minimum interval:

- 1 分未満は reject。
- 6-field cron は error: 「秒 field はサポートしていません」。

### Step 4: Codex settings

Fields:

- Codex binary path。通常は global setting を使用。
- Model。
- Reasoning effort。
- Sandbox mode。
- Approval policy。
- Max runtime。
- Retry count。
- Overlap policy。
- Missed run policy。

### Step 5: Schedule CLI permissions

Fields:

- Allow Codex session to create schedules。
- Allow update current task。
- Allow update any task。
- Max created schedules per run。
- Force newly created tasks as paused。

Default:

- create: on。
- update-current: on。
- update-any: off。
- max creates: 5。
- force paused: off for chat, on for untrusted repo path。

### Step 6: Review

Summary:

- task name。
- target。
- schedule。
- next run。
- Codex command preview。
- safety warnings。

Actions:

- Create。
- Create paused。
- Cancel。

## 6. Task detail

Sections:

- Header: name, status, run now, pause/resume, edit。
- Schedule card: expression, next run, missed policy。
- Prompt card: prompt preview, edit。
- Target card: repo/worktree settings。
- Permissions card。
- Recent runs table。
- Audit trail。

Actions:

- Run now。
- Pause/resume。
- Duplicate。
- Delete。
- Open prompt file if stored on disk。

## 7. Run detail

Sections:

- Status header。
- Timeline。
- Codex final message。
- Logs tabs: stdout, stderr, events JSONL。
- Git changes。
- Artifacts。
- Schedules created by this run。
- Environment summary redacted。

Actions:

- Cancel running。
- Retry。
- Open workspace。
- Open worktree in terminal。
- Copy final message。
- Export logs。

## 8. Runs / Triage

Triage は「あとで確認すべき run」の inbox。

Triage に入る条件:

- failed。
- timed_out。
- findings_count > 0。
- created_schedule_count > 0。
- worktree has changes。
- user marked。

Actions:

- Mark reviewed。
- Archive。
- Create follow-up task。
- Open run detail。

## 9. Projects

Project list:

- name。
- path。
- git remote。
- default branch。
- trusted status。
- active task count。

Project detail:

- trust/untrust。
- default execution mode。
- default sandbox。
- default model。
- cleanup worktrees。

## 10. Settings

### General

- Start at login。
- Keep app in menu bar。
- Scheduler enabled。
- Keep computer awake while running tasks。

### Codex CLI

- Codex binary path。
- Check installation。
- Run `codex doctor`。
- Default model。
- Default sandbox。

### Scheduler

- Global concurrency。
- Per-project concurrency。
- Default missed run policy。
- Default overlap policy。
- Default max runtime。

### Worktrees

- Worktree root。
- Cleanup policy。
- Delete older than N days。

### Notifications

- Started。
- Succeeded。
- Failed。
- Catch-up。

### Advanced

- Socket path。
- Database path。
- Export diagnostics。
- Reset local data。

## 11. shadcn/ui component map

| UI | shadcn components |
| --- | --- |
| Sidebar | `Sidebar`, `ScrollArea`, `Button` |
| Data tables | `Table`, `DropdownMenu`, `Checkbox`, `Badge` |
| Forms | `Form`, `Input`, `Textarea`, `Select`, `Switch`, `Calendar` |
| Wizard | `Dialog` or route-based form, `Tabs`, `Separator` |
| Warnings | `Alert`, `Tooltip`, `HoverCard` |
| Logs | `ScrollArea`, `Tabs`, monospace `<pre>` |
| Command palette | `Command` |
| Toast | `Sonner` |

## 12. Empty states

### No tasks

Message:

```text
まだタスクがありません。Codex に定期的に任せたい作業を作成しましょう。
```

CTA:

- New Task。
- Create example daily review。

### Codex CLI not configured

Message:

```text
Codex CLI が見つかりません。タスクを実行するには Codex CLI のパスを設定してください。
```

CTA:

- Locate Codex。
- Run doctor。

### Daemon not running

Message:

```text
スケジューラーデーモンに接続できません。
```

CTA:

- Restart daemon。
- Open logs。

## 13. Accessibility

- すべての主要操作に keyboard focus を提供。
- status は色だけでなく text/badge で表現。
- log view は copy 可能。
- destructive action は confirmation dialog。

## 14. Internationalization

MVP は日本語 UI を主対象とし、内部 task/prompt は任意言語。将来 i18n 対応しやすいよう UI text は辞書化する。

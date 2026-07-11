type LongCodexLogStep =
  | { kind: "message"; text: string }
  | {
      kind: "command";
      command: string;
      output?: string;
      exitCode: number;
    }
  | { kind: "search"; query: string };

type JsonObject = Record<string, unknown>;

// Derived from a real Codex CLI JSON event log. Paths and identifiers are sanitized.
const longCodexLogSteps = [
  {
    kind: "message",
    text: "東京の今日の天気を確認しつつ、2時間後の再チェックを同じスケジューラで設定します。まず現在時刻を確定してから、天気とスケジュール登録を確認します。",
  },
  {
    kind: "command",
    command: `date '+%Y-%m-%dT%H:%M:%S%z %Z'`,
    output: "2026-07-09T09:00:23+0900 JST\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command: "codex-schedule list --json",
    output: "zsh: command not found: codex-schedule\n",
    exitCode: 127,
  },
  { kind: "search", query: "weather: Tokyo, Japan" },
  { kind: "search", query: "weather: Japan, Tokyo" },
  {
    kind: "search",
    query: "Tokyo weather today July 9 2026 forecast",
  },
  {
    kind: "search",
    query: "site:jma.go.jp 東京 天気 7月9日 2026",
  },
  {
    kind: "search",
    query: "Japan Meteorological Agency Tokyo forecast",
  },
  {
    kind: "message",
    text: "天気はJMA、JNTO、Met Officeの公開予報で拾えました。スケジューラCLIがこのセッションのPATHでは見つからないので、実体の場所を確認してから登録を続けます。",
  },
  {
    kind: "command",
    command: "print -r -- $PATH",
    output:
      "/workspace/scheduler/apps/desktop/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command: "command -v codex-schedule",
    output: "",
    exitCode: 1,
  },
  {
    kind: "command",
    command:
      'ls -la /opt/homebrew/bin/codex-schedule /usr/local/bin/codex-schedule "$HOME/.local/bin/codex-schedule"',
    output: "ls: codex-schedule: No such file or directory\n",
    exitCode: 1,
  },
  {
    kind: "message",
    text: "PATHにはスケジューラ開発ディレクトリが入っていますが、`codex-schedule` という名前の実行ファイルはまだ見えていません。候補ディレクトリを絞って確認します。",
  },
  {
    kind: "command",
    command: "ls -la /workspace/scheduler/target/debug | sed -n '1,120p'",
    output: "ls: /workspace/scheduler/target/debug: No such file or directory\n",
    exitCode: 1,
  },
  {
    kind: "command",
    command:
      "find /workspace/scheduler -maxdepth 5 \\( -name 'codex*' -o -name '*schedule*' \\) | head -100",
    output: "",
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "find /workspace/scheduler -maxdepth 5 \\( -name '*schedule*' -o -name '*scheduler*' \\) -type f -perm +111 | head -50",
    output: "",
    exitCode: 0,
  },
  {
    kind: "message",
    text: "スケジューラ本体の配置が、案内のPATHと実ファイル名で少しずれているようです。調査は続けつつ、2時間後は `2026-07-09T11:00:23+09:00` 前後として扱います。",
  },
  {
    kind: "command",
    command:
      'ls -la "/workspace/scheduler/apps/desktop/src-tauri/../../../target/debug"',
    output: "ls: target/debug: No such file or directory\n",
    exitCode: 1,
  },
  {
    kind: "command",
    command: "ls -la $HOME/.codex/tmp/arg0/codex-arg0",
    output: "apply_patch -> /opt/homebrew/bin/apply_patch\ncodex -> /Applications/Codex.app\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "find /workspace/scheduler -maxdepth 8 -type f \\( -name 'package.json' -o -name 'Cargo.toml' \\) | head -100",
    output:
      "/workspace/scheduler/Cargo.toml\n/workspace/scheduler/crates/scheduler-core/Cargo.toml\n/workspace/scheduler/crates/codex-runner/Cargo.toml\n/workspace/scheduler/crates/schedule-cli/Cargo.toml\n/workspace/scheduler/crates/schedulerd/Cargo.toml\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "find /workspace/scheduler -maxdepth 8 -type f \\( -perm +111 -o -name '*.sh' \\) | sed -n '/codex\\|sched/p' | head -100",
    output: "",
    exitCode: 0,
  },
  {
    kind: "message",
    text: "`codex-schedule` は直接はありませんが、scheduler のRustワークスペースに `schedule-cli` crate が見つかりました。CLI名や実行方法を確認して、同等のコマンドで登録できるか見ます。",
  },
  {
    kind: "command",
    command:
      "sed -n '1,220p' /workspace/scheduler/crates/schedule-cli/Cargo.toml",
    output:
      '[[bin]]\nname = "codex-schedule"\npath = "src/main.rs"\n',
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "ls -la /workspace/scheduler/target/debug /workspace/scheduler/target/release",
    output:
      "/workspace/scheduler/target/debug:\ncodex-schedule\nschedulerd\n",
    exitCode: 1,
  },
  {
    kind: "command",
    command:
      'rg -n "codex-schedule|schedule-cli|update-current|create|Subcommand|clap" /workspace/scheduler/crates/schedule-cli /workspace/scheduler/crates/scheduler-core | head -200',
    output:
      "crates/schedule-cli/src/main.rs:21:struct Cli\ncrates/schedule-cli/src/main.rs:44:enum Command\ncrates/schedule-cli/src/main.rs:58:Create\ncrates/schedule-cli/src/main.rs:72:UpdateCurrent\n",
    exitCode: 0,
  },
  {
    kind: "message",
    text: "実行ファイルは `/workspace/scheduler/target/debug/codex-schedule` にありました。PATHから外れているだけなので、これを直接呼んで現在タスクを確認します。",
  },
  {
    kind: "command",
    command: "env | rg 'SCHEDULE|SCHEDULER|CURRENT|RUN_ID|TASK_ID'",
    output:
      "CODEX_SCHEDULER=1\nCODEX_SCHEDULER_CURRENT_RUN_ID=run_demo_long\nCODEX_SCHEDULER_CURRENT_TASK_ID=task_weather_check\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command: "/workspace/scheduler/target/debug/codex-schedule --help",
    output:
      "Manage Clockhand tasks\n\nCommands:\n  create\n  update\n  update-current\n  list\n  show\n  pause\n  resume\n  delete\n  run-now\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command: "/workspace/scheduler/target/debug/codex-schedule list --json",
    output:
      '{"ok":true,"tasks":[{"id":"task_weather_check","kind":"once","name":"Tokyo weather","status":"completed"}]}\n',
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "/workspace/scheduler/target/debug/codex-schedule update-current --help",
    output: "Usage: codex-schedule update-current [OPTIONS]\n",
    exitCode: 0,
  },
  {
    kind: "command",
    command: "/workspace/scheduler/target/debug/codex-schedule create --help",
    output:
      "Usage: codex-schedule create [OPTIONS]\n  --name <NAME>\n  --at <AT>\n  --timezone <TIMEZONE>\n  --prompt <PROMPT>\n",
    exitCode: 0,
  },
  {
    kind: "message",
    text: "現在の実行は一度完了扱いのタスクなので、既存タスクを書き換えるより2時間後の単発フォローアップを新規作成します。未来の実行がさらに自己増殖しないよう、再チェックだけを依頼するプロンプトにします。",
  },
  {
    kind: "command",
    command:
      '/workspace/scheduler/target/debug/codex-schedule create --name "Tokyo weather recheck" --at "2026-07-09T11:00:00+09:00" --timezone "Asia/Tokyo" --chat --prompt "東京の今日の天気を再チェックして、現在の予報と注意点を簡潔に日本語で報告してください。追加のフォローアップ予定は作成しないでください。" --json',
    output:
      '{"ok":true,"task":{"id":"task_weather_recheck","kind":"once","name":"Tokyo weather recheck","nextRunAt":"2026-07-09T02:00:00Z"}}\n',
    exitCode: 0,
  },
  {
    kind: "message",
    text: "2時間後の単発チェックは作成できました。最後に登録内容だけ確認して、天気の要約を返します。",
  },
  {
    kind: "command",
    command:
      "/workspace/scheduler/target/debug/codex-schedule show task_weather_recheck --json",
    output:
      '{"ok":true,"task":{"id":"task_weather_recheck","locked":false,"name":"Tokyo weather recheck","nextRunAt":"2026-07-09T02:00:00Z"}}\n',
    exitCode: 0,
  },
  {
    kind: "search",
    query: "https://www.data.jma.go.jp/multi/yoho/yoho_detail.html?code=130010&lang=jp",
  },
  {
    kind: "search",
    query: "site:jma.go.jp 東京地方 降水確率 最高気温",
  },
  {
    kind: "search",
    query: "JMA Tokyo forecast JSON 130000",
  },
  {
    kind: "search",
    query: "Japan travel Tokyo weather today",
  },
  {
    kind: "search",
    query: "Met Office Tokyo weather forecast",
  },
  {
    kind: "message",
    text: "気象庁の画面は検索結果では読めますが、ページ本体は動的表示で本文が取りにくいです。公式の予報JSONが使えるので、そちらから東京地方の値を直接確認します。",
  },
  {
    kind: "command",
    command:
      "curl -fsSL https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json | jq '.[0].publishingOffice, .[0].reportDatetime, .[0].timeSeries[0].areas[] | select(.area.name==\"東京地方\")'",
    output: 'jq: error: Cannot index string with string "area"\n',
    exitCode: 5,
  },
  {
    kind: "command",
    command:
      "curl -fsSL https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json | jq '.[0].timeSeries[2].areas[] | select(.area.name==\"東京\")'",
    output:
      '{\n  "area": { "name": "東京", "code": "44132" },\n  "temps": ["31", "31", "22", "31"]\n}\n',
    exitCode: 0,
  },
  {
    kind: "message",
    text: "公式JSONから、東京の気温は今日の最高31℃付近と出ています。天気・降水確率の配列も同じJSONから読み直して、最終回答に反映します。",
  },
  {
    kind: "command",
    command:
      "curl -fsSL https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json | jq '.[0] | {pop_timeDefines:.timeSeries[1].timeDefines, pop_area:(.timeSeries[1].areas[] | select(.area.name==\"東京地方\"))}'",
    output:
      '{\n  "pop_timeDefines": ["2026-07-09T06:00:00+09:00", "2026-07-09T12:00:00+09:00", "2026-07-09T18:00:00+09:00"],\n  "pops": ["0", "10", "10"]\n}\n',
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "curl -fsSL https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json | jq '.[0] | {publishingOffice, reportDatetime, weather_area:(.timeSeries[0].areas[] | select(.area.name==\"東京地方\"))}'",
    output:
      '{\n  "publishingOffice": "気象庁",\n  "reportDatetime": "2026-07-09T05:00:00+09:00",\n  "weather": "晴れ時々くもり"\n}\n',
    exitCode: 0,
  },
  {
    kind: "command",
    command:
      "curl -fsSL https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json | jq '.[0] | {temp_timeDefines:.timeSeries[2].timeDefines, temp_area:(.timeSeries[2].areas[] | select(.area.name==\"東京\"))}'",
    output:
      '{\n  "temp_timeDefines": ["2026-07-09T09:00:00+09:00", "2026-07-10T00:00:00+09:00"],\n  "temps": ["31", "22"]\n}\n',
    exitCode: 0,
  },
  {
    kind: "message",
    text: "東京（2026年7月9日 09:00 JST時点）は、**晴れ時々くもり**です。気象庁の05:00発表では、東京地方の降水確率は **午前0%、午後10%、夜10%**、東京の最高気温は **31℃前後**です。外出は暑さ対策をして、雨具は基本不要そうです。\nSource: https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json\n\n2時間後の再チェックも設定済みです。\n`2026-07-09 11:00 JST` に単発で実行されます。",
  },
] satisfies LongCodexLogStep[];

function eventsForStep(
  step: LongCodexLogStep,
  index: number,
): JsonObject[] {
  if (step.kind === "message") {
    return [
      {
        type: "item.completed",
        item: {
          id: `long_message_${index}`,
          type: "agent_message",
          text: step.text,
        },
      },
    ];
  }

  if (step.kind === "search") {
    const item = {
      id: `long_search_${index}`,
      type: "web_search",
      query: step.query,
      action: { type: "search", query: step.query },
    };
    return [
      { type: "item.started", item },
      { type: "item.completed", item },
    ];
  }

  const id = `long_command_${index}`;
  return [
    {
      type: "item.started",
      item: {
        id,
        type: "command_execution",
        command: step.command,
        aggregated_output: "",
        exit_code: null,
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        id,
        type: "command_execution",
        command: step.command,
        aggregated_output: step.output ?? "",
        exit_code: step.exitCode,
        status: step.exitCode === 0 ? "completed" : "failed",
      },
    },
  ];
}

const longCodexEvents = [
  { type: "thread.started", thread_id: "thread_demo_long" },
  { type: "turn.started" },
  ...longCodexLogSteps.flatMap(eventsForStep),
  {
    type: "turn.completed",
    usage: { input_tokens: 32_846, output_tokens: 4_812 },
  },
];

export const longCodexEventLog = `${longCodexEvents
  .map((event) => JSON.stringify(event))
  .join("\n")}\n`;

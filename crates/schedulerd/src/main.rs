use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "codex-schedulerd")]
#[command(about = "Codex Scheduler daemon scaffold")]
struct Args {
    #[arg(long, env = "CODEX_SCHEDULER_LOG", default_value = "info")]
    log_level: String,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let _ = args.log_level;

    tracing_subscriber::fmt::init();
    tracing::info!(
        app = scheduler_core::APP_NAME,
        service = schedulerd::service_name(),
        "daemon scaffold started"
    );

    Ok(())
}

use clap::Parser;
use serde::Serialize;

#[derive(Debug, Parser)]
#[command(name = "codex-schedule")]
#[command(about = "Codex Scheduler session CLI scaffold")]
struct Args {
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Serialize)]
struct Status<'a> {
    name: &'a str,
    scaffold: bool,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if args.json {
        let status = Status {
            name: schedule_cli::cli_name(),
            scaffold: schedule_cli::is_scaffold(),
        };
        println!("{}", serde_json::to_string(&status)?);
    } else {
        println!("{} scaffold", schedule_cli::cli_name());
    }

    Ok(())
}

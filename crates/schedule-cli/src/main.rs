#[tokio::main]
async fn main() {
    std::process::exit(schedule_cli::run_cli(std::env::args_os()).await);
}

use std::path::Path;
use std::time::Duration;

use scheduler_core::ipc::{
    DaemonHealthResult, JsonRpcError, JsonRpcErrorCode, JsonRpcId, JsonRpcRequest, JsonRpcResponse,
    JSONRPC_VERSION, METHOD_DAEMON_HEALTH,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

pub async fn health_check(socket_path: &Path) -> anyhow::Result<DaemonHealthResult> {
    call(socket_path, METHOD_DAEMON_HEALTH, serde_json::json!({})).await
}

pub async fn call<T, P>(socket_path: &Path, method: &str, params: P) -> anyhow::Result<T>
where
    T: DeserializeOwned,
    P: Serialize,
{
    let response = call_raw(socket_path, method, params).await?;
    if let Some(error) = response.error {
        anyhow::bail!("rpc error {}: {}", error.code, error.message);
    }
    let result = response
        .result
        .ok_or_else(|| anyhow::anyhow!("missing rpc result"))?;
    Ok(serde_json::from_value(result)?)
}

pub async fn call_raw<P>(
    socket_path: &Path,
    method: &str,
    params: P,
) -> anyhow::Result<JsonRpcResponse>
where
    P: Serialize,
{
    let request = JsonRpcRequest {
        jsonrpc: JSONRPC_VERSION.to_owned(),
        id: Some(JsonRpcId::String("1".to_owned())),
        method: method.to_owned(),
        params: Some(serde_json::to_value(params)?),
    };
    let line = serde_json::to_string(&request)?;

    let stream =
        tokio::time::timeout(Duration::from_secs(2), UnixStream::connect(socket_path)).await??;
    let (read, mut write) = stream.into_split();
    write.write_all(line.as_bytes()).await?;
    write.write_all(b"\n").await?;
    write.flush().await?;

    let mut lines = BufReader::new(read).lines();
    let response = tokio::time::timeout(Duration::from_secs(2), lines.next_line())
        .await??
        .ok_or_else(|| anyhow::anyhow!("connection closed before response"))?;
    Ok(serde_json::from_str(&response)?)
}

pub fn parse_params<T: DeserializeOwned>(
    params: Option<serde_json::Value>,
) -> Result<T, JsonRpcError> {
    serde_json::from_value(params.unwrap_or_else(|| serde_json::json!({}))).map_err(|err| {
        JsonRpcError::new(
            JsonRpcErrorCode::InvalidParams,
            format!("invalid params: {err}"),
        )
    })
}

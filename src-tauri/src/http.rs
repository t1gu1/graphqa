//! Envoi des requêtes GraphQL depuis Rust.
//!
//! Passer par Rust plutôt que par `fetch` dans la webview évite les blocages
//! CORS : un outil de QA doit pouvoir viser n'importe quel back-end, même s'il
//! n'autorise pas l'origine de l'application.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphqlRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub timeout_ms: Option<u64>,
    pub insecure_tls: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphqlResponse {
    pub status: u16,
    pub duration_ms: u64,
    pub size_bytes: usize,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

/// Les erreurs sont préfixées par un code (`TIMEOUT|`, `CONNECT|`, `REQUEST|`)
/// que l'interface traduit en message lisible.
fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        format!("TIMEOUT|{e}")
    } else if e.is_connect() {
        format!("CONNECT|{e}")
    } else if e.is_builder() {
        format!("INVALID|{e}")
    } else {
        format!("REQUEST|{e}")
    }
}

#[tauri::command]
pub async fn graphql_request(request: GraphqlRequest) -> Result<GraphqlResponse, String> {
    let url = request.url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("INVALID|L'adresse doit commencer par http:// ou https://".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(request.timeout_ms.unwrap_or(30_000)))
        .danger_accept_invalid_certs(request.insecure_tls.unwrap_or(false))
        .user_agent(concat!("GraphQA/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(describe)?;

    let mut builder = client
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/graphql-response+json, application/json");

    for (key, value) in request.headers {
        let key = key.trim();
        if !key.is_empty() {
            builder = builder.header(key, value);
        }
    }

    let started = Instant::now();
    let response = builder.body(request.body).send().await.map_err(describe)?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect();
    let bytes = response.bytes().await.map_err(describe)?;

    Ok(GraphqlResponse {
        status,
        duration_ms: started.elapsed().as_millis() as u64,
        size_bytes: bytes.len(),
        body: String::from_utf8_lossy(&bytes).into_owned(),
        headers,
    })
}

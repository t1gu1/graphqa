//! Pont vers les assistants IA en ligne de commande (Claude CLI, Copilot CLI).
//!
//! Les outils tournent sur le poste de l'utilisateur, avec son propre compte.
//! GraphQA ne leur transmet que le texte préparé par l'interface : jamais les
//! jetons ni les en-têtes d'authentification.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub message: Option<String>,
}

fn binary_name(agent: &str) -> Result<&'static str, String> {
    match agent {
        "claude" => Ok("claude"),
        "copilot" => Ok("copilot"),
        other => Err(format!("INVALID|Assistant inconnu : {other}")),
    }
}

/// Une application lancée depuis le Finder ou un menu n'hérite pas du PATH du
/// terminal. On reconstitue donc un PATH raisonnable : celui du processus,
/// celui du shell de connexion (Unix) et les dossiers d'installation courants.
fn search_path() -> &'static std::ffi::OsString {
    static PATH: OnceLock<std::ffi::OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<PathBuf> = Vec::new();
        let mut push = |p: PathBuf| {
            if !p.as_os_str().is_empty() && !dirs.contains(&p) {
                dirs.push(p);
            }
        };
        if let Some(p) = std::env::var_os("PATH") {
            std::env::split_paths(&p).for_each(&mut push);
        }
        #[cfg(unix)]
        {
            if let Some(p) = login_shell_path() {
                std::env::split_paths(&p).for_each(&mut push);
            }
            if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
                for sub in [".local/bin", ".claude/local", ".npm-global/bin", ".volta/bin", ".bun/bin", ".yarn/bin"] {
                    push(home.join(sub));
                }
            }
            for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
                push(PathBuf::from(d));
            }
        }
        #[cfg(windows)]
        {
            if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
                push(appdata.join("npm"));
            }
            if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
                push(profile.join(".local").join("bin"));
            }
        }
        std::env::join_paths(dirs).unwrap_or_default()
    })
}

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::time::Instant;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut child = std::process::Command::new(shell)
        .args(["-ilc", "printf '__GQA__%s__GQA__' \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let start = out.find("__GQA__")? + "__GQA__".len();
    let end = out[start..].find("__GQA__")? + start;
    Some(out[start..end].to_string())
}

fn resolve_binary(name: &str) -> Option<PathBuf> {
    let candidates: Vec<String> = if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), format!("{name}.bat")]
    } else {
        vec![name.to_string()]
    };
    std::env::split_paths(search_path())
        .flat_map(|dir| candidates.iter().map(move |c| dir.join(c)))
        .find(|p| p.is_file())
}

async fn run(
    binary: &Path,
    args: &[String],
    stdin: Option<String>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(binary);
    cmd.args(args)
        .env("PATH", search_path())
        .current_dir(std::env::temp_dir())
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("FAILED|{e}"))?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(text.as_bytes()).await.map_err(|e| format!("FAILED|{e}"))?;
        drop(pipe);
    }
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| format!("FAILED|{e}")),
        Err(_) => Err("TIMEOUT|L'assistant n'a pas répondu à temps.".into()),
    }
}

fn tail(text: &[u8], max: usize) -> String {
    let s = String::from_utf8_lossy(text);
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let skip = s.chars().count() - max;
    format!("…{}", s.chars().skip(skip).collect::<String>())
}

#[tauri::command]
pub async fn agent_detect(agent: String) -> Result<AgentStatus, String> {
    let name = binary_name(&agent)?;
    let Some(path) = resolve_binary(name) else {
        return Ok(AgentStatus {
            found: false,
            version: None,
            path: None,
            message: Some(format!("La commande « {name} » est introuvable sur ce poste.")),
        });
    };
    let output = run(&path, &["--version".to_string()], None, Duration::from_secs(20)).await;
    Ok(match output {
        Ok(out) if out.status.success() => AgentStatus {
            found: true,
            version: String::from_utf8_lossy(&out.stdout).lines().next().map(|l| l.trim().to_string()),
            path: Some(path.display().to_string()),
            message: None,
        },
        Ok(out) => AgentStatus {
            found: false,
            version: None,
            path: Some(path.display().to_string()),
            message: Some(tail(&out.stderr, 400)),
        },
        Err(e) => AgentStatus { found: false, version: None, path: Some(path.display().to_string()), message: Some(e) },
    })
}

#[tauri::command]
pub async fn agent_ask(agent: String, prompt: String) -> Result<String, String> {
    let name = binary_name(&agent)?;
    let path = resolve_binary(name)
        .ok_or_else(|| format!("NOT_FOUND|La commande « {name} » est introuvable sur ce poste."))?;

    // Claude CLI lit la demande sur l'entrée standard en mode non interactif (-p).
    // Copilot CLI la reçoit en argument : on l'aplatit sur une ligne pour rester
    // compatible avec les scripts .cmd de Windows.
    let (args, stdin) = match name {
        "claude" => (vec!["-p".to_string(), "--output-format".to_string(), "text".to_string()], Some(prompt)),
        _ => {
            let flat = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
            (vec!["-p".to_string(), flat], None)
        }
    };

    let out = run(&path, &args, stdin, Duration::from_secs(240)).await?;
    if out.status.success() {
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            Err(format!("FAILED|Réponse vide. {}", tail(&out.stderr, 400)))
        } else {
            Ok(text)
        }
    } else {
        let detail = if out.stderr.is_empty() { tail(&out.stdout, 600) } else { tail(&out.stderr, 600) };
        Err(format!("FAILED|{detail}"))
    }
}

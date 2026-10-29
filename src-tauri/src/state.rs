//! Sauvegarde locale : projets, environnements, bibliothèque de tests et réglages
//! sont gardés dans un seul fichier JSON du dossier de données de l'application.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Dossier de données introuvable : {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {}: {e}", dir.display()))?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
pub fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Lecture impossible de {}: {e}", path.display()))
}

#[tauri::command]
pub fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let path = state_file(&app)?;
    // Écriture atomique : on écrit à côté puis on renomme, pour ne jamais
    // laisser un fichier à moitié écrit si l'application est fermée en cours.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Écriture impossible : {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Écriture impossible : {e}"))
}

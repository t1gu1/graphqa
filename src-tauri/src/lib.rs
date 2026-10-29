mod agent;
mod http;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            http::graphql_request,
            state::load_state,
            state::save_state,
            agent::agent_detect,
            agent::agent_ask,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de GraphQA");
}

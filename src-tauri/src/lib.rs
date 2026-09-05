use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:strategist.db",
                    vec![Migration {
                        version: 1,
                        description: "foundation",
                        sql: include_str!("../../src/storage/schema.sql"),
                        kind: MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("Unable to start TFT Strategist");
}

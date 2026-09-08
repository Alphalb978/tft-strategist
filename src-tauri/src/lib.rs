use tauri_plugin_sql::{Migration, MigrationKind};

mod credentials;
mod external_meta;
mod lcu;
mod riot;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:strategist.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "foundation",
                            sql: include_str!("../../src/storage/schema.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "native Riot history and scouting",
                            sql: include_str!("../../src/storage/schema_m3.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "versioned active plan sessions",
                            sql: include_str!("../../src/storage/schema_m8.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "postgame reconciliation reviews and personal learning",
                            sql: include_str!("../../src/storage/schema_m9.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "versioned TFT knowledge foundation",
                            sql: include_str!("../../src/storage/schema_m13.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(riot::RiotState::from_environment())
        .invoke_handler(tauri::generate_handler![
            external_meta::external_meta_snapshot,
            external_meta::external_meta_history,
            external_meta::refresh_external_meta,
            lcu::league_client_gameflow,
            lcu::league_client_summoner,
            riot::riot_connection_status,
            riot::riot_save_key,
            riot::riot_remove_key,
            riot::riot_test_connection,
            riot::riot_metrics,
            riot::riot_cancel_request,
            riot::riot_resolve_account,
            riot::riot_account_by_puuid,
            riot::riot_recent_match_ids,
            riot::riot_completed_match,
            riot::riot_tft_ladder,
            riot::riot_tft_summoner_by_id,
            riot::riot_current_game,
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start TFT Strategist");
}

use tauri_plugin_sql::{Migration, MigrationKind};

mod credentials;
mod external_meta;
mod lcu;
mod riot;
mod screen_capture;
pub mod shop_vision;
pub mod board_vision;
pub mod owned_unit_audit;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let vision_engine = shop_vision::ShopVisionEngine::new();
    let board_engine = board_vision::BoardVisionEngine::new();
    let capture_manager = screen_capture::ScreenCaptureManager::new_with_vision(
        Some(vision_engine.clone()),
        Some(board_engine.clone()),
    );

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
                        Migration {
                            version: 6,
                            description: "personal match observations and account-first ledger",
                            sql: include_str!("../../src/storage/schema_m13d.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 7,
                            description: "personal match manual comp corrections",
                            sql: include_str!("../../src/storage/schema_m13d2.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(riot::RiotState::from_environment())
        .manage(shop_vision::ShopVisionStateHandle {
            inner: vision_engine,
        })
        .manage(board_vision::BoardVisionStateHandle {
            inner: board_engine,
        })
        .manage(screen_capture::ScreenCaptureStateHandle {
            inner: capture_manager,
        })
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
            screen_capture::screen_capture_get_state,
            screen_capture::screen_capture_status,
            screen_capture::screen_capture_configure,
            screen_capture::screen_capture_get_preview,
            screen_capture::screen_capture_preview,
            screen_capture::screen_capture_poll,
            shop_vision::screen_shop_status,
            board_vision::screen_owned_units_status,
            board_vision::start_owned_unit_audit,
            board_vision::stop_owned_unit_audit,
            board_vision::get_owned_unit_audit_status,
            board_vision::clear_owned_unit_audit,
            board_vision::export_owned_unit_audit,
            board_vision::add_manual_audit_label,
            board_vision::add_missed_audit_event,
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start TFT Strategist");
}

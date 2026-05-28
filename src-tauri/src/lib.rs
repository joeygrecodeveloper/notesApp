mod commands;
use tauri::menu::{MenuItem, MenuItemKind};
use tauri::Emitter;
use tauri::Manager;
use sqlx::Executor;
use sqlx::SqlitePool;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_notes_table",
            sql: "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_sort_order_column",
            sql: "ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "seed_sort_order",
            sql: "UPDATE notes SET sort_order = (SELECT COUNT(*) FROM notes n2 WHERE n2.rowid <= notes.rowid)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_collapsed_headings_column",
            sql: "ALTER TABLE notes ADD COLUMN collapsed_headings TEXT DEFAULT NULL",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_parent_id_column",
            sql: "ALTER TABLE notes ADD COLUMN parent_id INTEGER DEFAULT NULL REFERENCES notes(id)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_is_expanded_column",
            sql: "ALTER TABLE notes ADD COLUMN is_expanded INTEGER NOT NULL DEFAULT 1",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_is_expanded_noop",
            sql: "SELECT 1",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_settings_table",
            sql: "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .setup(move |app| {
            let db_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create db dir {:?}: {}", db_dir, e))?;
            let db_path = db_dir.join("notes.db");
            let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePool::connect(&db_url).await?;

                sqlx::query(
                    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)"
                )
                .execute(&pool)
                .await?;

                for migration in &migrations {
                    let exists: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE version = ?)"
                    )
                    .bind(migration.version)
                    .fetch_one(&pool)
                    .await?;

                    if !exists {
                        pool.execute(migration.sql).await?;
                        sqlx::query("INSERT INTO _migrations (version) VALUES (?)")
                            .bind(migration.version)
                            .execute(&pool)
                            .await?;
                    }
                }

                Ok::<SqlitePool, sqlx::Error>(pool)
            })
            .map_err(|e| e.to_string())?;
            app.manage(pool);

            let rich_paste = MenuItem::with_id(app, "rich_paste", "Rich Paste", true, Some("CmdOrCtrl+Alt+Shift+V"))?;
            if let Some(menu) = app.menu() {
                for item in menu.items()? {
                    if let MenuItemKind::Submenu(submenu) = item {
                        if submenu.text()?.as_str() == "Edit" {
                            submenu.append(&rich_paste)?;
                            break;
                        }
                    }
                }
            }
            app.on_menu_event(|app, event| {
                if event.id() == "rich_paste" {
                    let _ = app.emit("rich-paste-shortcut", ());
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::fetch_url_metadata,
            commands::update_note_expanded,
            commands::save_setting,
            commands::get_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

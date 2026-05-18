mod commands;
use tauri::menu::{MenuItem, MenuItemKind};
use tauri::Emitter;
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
    ];

    tauri::Builder::default()
        .setup(|app| {
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:notes.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![commands::fetch_url_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

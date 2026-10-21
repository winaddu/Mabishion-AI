// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(feature = "sqlite")]
use std::collections::HashMap;
#[cfg(feature = "sqlite")]
use std::fs::{create_dir_all, read_to_string, write};

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
#[cfg(feature = "sqlite")]
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
#[cfg(any(feature = "sqlite", feature = "mysql", feature = "postgres"))]
use sqlx::{Column, Connection, Executor, Pool, Row};
#[cfg(feature = "sqlite")]
use std::str::FromStr;
#[cfg(any(feature = "sqlite", feature = "mysql", feature = "postgres"))]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

#[cfg(feature = "mysql")]
use sqlx::MySql;
#[cfg(feature = "postgres")]
use sqlx::Postgres;
#[cfg(feature = "sqlite")]
use sqlx::Sqlite;

use crate::LastInsertId;

pub enum DbPool {
    #[cfg(feature = "sqlite")]
    Sqlite(Pool<Sqlite>),
    #[cfg(feature = "mysql")]
    MySql(Pool<MySql>),
    #[cfg(feature = "postgres")]
    Postgres(Pool<Postgres>),
    #[cfg(not(any(feature = "sqlite", feature = "mysql", feature = "postgres")))]
    None,
}

// public methods
/* impl DbPool {
    /// Get the inner Sqlite Pool. Returns None for MySql and Postgres pools.
    #[cfg(feature = "sqlite")]
    pub fn sqlite(&self) -> Option<&Pool<Sqlite>> {
        match self {
            DbPool::Sqlite(pool) => Some(pool),
            _ => None,
        }
    }

    /// Get the inner MySql Pool. Returns None for Sqlite and Postgres pools.
    #[cfg(feature = "mysql")]
    pub fn mysql(&self) -> Option<&Pool<MySql>> {
        match self {
            DbPool::MySql(pool) => Some(pool),
            _ => None,
        }
    }

    /// Get the inner Postgres Pool. Returns None for MySql and Sqlite pools.
    #[cfg(feature = "postgres")]
    pub fn postgres(&self) -> Option<&Pool<Postgres>> {
        match self {
            DbPool::Postgres(pool) => Some(pool),
            _ => None,
        }
    }
} */

// private methods
impl DbPool {
    pub(crate) async fn connect<R: Runtime>(
        conn_url: &str,
        _app: &AppHandle<R>,
    ) -> Result<Self, crate::Error> {
        match conn_url
            .split_once(':')
            .ok_or_else(|| crate::Error::InvalidDbUrl(conn_url.to_string()))?
            .0
        {
            #[cfg(feature = "sqlite")]
            "sqlite" => {
                let app_path = _app
                    .path()
                    .app_config_dir()
                    .expect("No App config path was found!");

                create_dir_all(&app_path).expect("Couldn't create app config dir");

                let conn_url = path_mapper(app_path.clone(), conn_url);
                let key = database_key(&app_path)?;
                migrate_plaintext_database(&conn_url, &key).await?;
                let options = SqliteConnectOptions::from_str(&conn_url)
                    .map_err(crate::Error::Sql)?
                    .pragma("key", key)
                    .create_if_missing(true);
                Ok(Self::Sqlite(Pool::connect_with(options).await?))
            }
            #[cfg(feature = "mysql")]
            "mysql" => {
                if !MySql::database_exists(conn_url).await.unwrap_or(false) {
                    MySql::create_database(conn_url).await?;
                }
                Ok(Self::MySql(Pool::connect(conn_url).await?))
            }
            #[cfg(feature = "postgres")]
            "postgres" => {
                if !Postgres::database_exists(conn_url).await.unwrap_or(false) {
                    Postgres::create_database(conn_url).await?;
                }
                Ok(Self::Postgres(Pool::connect(conn_url).await?))
            }
            #[cfg(not(any(feature = "sqlite", feature = "postgres", feature = "mysql")))]
            _ => Err(crate::Error::InvalidDbUrl(format!(
                "{conn_url} - No database driver enabled!"
            ))),
            #[cfg(any(feature = "sqlite", feature = "postgres", feature = "mysql"))]
            _ => Err(crate::Error::InvalidDbUrl(conn_url.to_string())),
        }
    }

    pub(crate) async fn migrate(
        &self,
        _migrator: &sqlx::migrate::Migrator,
    ) -> Result<(), crate::Error> {
        match self {
            #[cfg(feature = "sqlite")]
            DbPool::Sqlite(pool) => _migrator.run(pool).await?,
            #[cfg(feature = "mysql")]
            DbPool::MySql(pool) => _migrator.run(pool).await?,
            #[cfg(feature = "postgres")]
            DbPool::Postgres(pool) => _migrator.run(pool).await?,
            #[cfg(not(any(feature = "sqlite", feature = "mysql", feature = "postgres")))]
            DbPool::None => (),
        }
        Ok(())
    }

    pub(crate) async fn close(&self) {
        match self {
            #[cfg(feature = "sqlite")]
            DbPool::Sqlite(pool) => pool.close().await,
            #[cfg(feature = "mysql")]
            DbPool::MySql(pool) => pool.close().await,
            #[cfg(feature = "postgres")]
            DbPool::Postgres(pool) => pool.close().await,
            #[cfg(not(any(feature = "sqlite", feature = "mysql", feature = "postgres")))]
            DbPool::None => (),
        }
    }

    pub(crate) async fn execute(
        &self,
        _query: String,
        _values: Vec<JsonValue>,
    ) -> Result<(u64, LastInsertId), crate::Error> {
        Ok(match self {
            #[cfg(feature = "sqlite")]
            DbPool::Sqlite(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let result = pool.execute(query).await?;
                (
                    result.rows_affected(),
                    LastInsertId::Sqlite(result.last_insert_rowid()),
                )
            }
            #[cfg(feature = "mysql")]
            DbPool::MySql(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let result = pool.execute(query).await?;
                (
                    result.rows_affected(),
                    LastInsertId::MySql(result.last_insert_id()),
                )
            }
            #[cfg(feature = "postgres")]
            DbPool::Postgres(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let result = pool.execute(query).await?;
                (result.rows_affected(), LastInsertId::Postgres(()))
            }
            #[cfg(not(any(feature = "sqlite", feature = "mysql", feature = "postgres")))]
            DbPool::None => (0, LastInsertId::None),
        })
    }

    pub(crate) async fn select(
        &self,
        _query: String,
        _values: Vec<JsonValue>,
    ) -> Result<Vec<IndexMap<String, JsonValue>>, crate::Error> {
        Ok(match self {
            #[cfg(feature = "sqlite")]
            DbPool::Sqlite(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let rows = pool.fetch_all(query).await?;
                let mut values = Vec::new();
                for row in rows {
                    let mut value = IndexMap::default();
                    for (i, column) in row.columns().iter().enumerate() {
                        let v = row.try_get_raw(i)?;

                        let v = crate::decode::sqlite::to_json(v)?;

                        value.insert(column.name().to_string(), v);
                    }

                    values.push(value);
                }
                values
            }
            #[cfg(feature = "mysql")]
            DbPool::MySql(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let rows = pool.fetch_all(query).await?;
                let mut values = Vec::new();
                for row in rows {
                    let mut value = IndexMap::default();
                    for (i, column) in row.columns().iter().enumerate() {
                        let v = row.try_get_raw(i)?;

                        let v = crate::decode::mysql::to_json(v)?;

                        value.insert(column.name().to_string(), v);
                    }

                    values.push(value);
                }
                values
            }
            #[cfg(feature = "postgres")]
            DbPool::Postgres(pool) => {
                let mut query = sqlx::query(&_query);
                for value in _values {
                    if value.is_null() {
                        query = query.bind(None::<JsonValue>);
                    } else if value.is_string() {
                        query = query.bind(value.as_str().unwrap().to_owned())
                    } else if let Some(number) = value.as_number() {
                        query = query.bind(number.as_f64().unwrap_or_default())
                    } else {
                        query = query.bind(value);
                    }
                }
                let rows = pool.fetch_all(query).await?;
                let mut values = Vec::new();
                for row in rows {
                    let mut value = IndexMap::default();
                    for (i, column) in row.columns().iter().enumerate() {
                        let v = row.try_get_raw(i)?;

                        let v = crate::decode::postgres::to_json(v)?;

                        value.insert(column.name().to_string(), v);
                    }

                    values.push(value);
                }
                values
            }
            #[cfg(not(any(feature = "sqlite", feature = "mysql", feature = "postgres")))]
            DbPool::None => Vec::new(),
        })
    }
}

#[cfg(feature = "sqlite")]
async fn migrate_plaintext_database(conn_url: &str, key: &str) -> Result<(), crate::Error> {
    let path = std::path::PathBuf::from(
        conn_url
            .strip_prefix("sqlite:")
            .ok_or_else(|| crate::Error::InvalidDbUrl(conn_url.to_string()))?,
    );
    if !path.exists() {
        return Ok(());
    }
    let header = std::fs::read(&path).map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    if header.len() < 16 || &header[..16] != b"SQLite format 3\0" {
        return Ok(());
    }

    let tmp = path.with_extension("db.encrypted.tmp");
    let backup = path.with_extension("db.plaintext.backup");
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&backup);

    let plain_options = SqliteConnectOptions::from_str(conn_url)
        .map_err(crate::Error::Sql)?
        .create_if_missing(false);
    let mut plain = SqliteConnection::connect_with(&plain_options).await?;
    let tmp_string = tmp.to_string_lossy().to_string();
    sqlx::query("ATTACH DATABASE ? AS encrypted KEY ?")
        .bind(&tmp_string)
        .bind(key)
        .execute(&mut plain)
        .await?;
    sqlx::query("SELECT sqlcipher_export('encrypted')")
        .execute(&mut plain)
        .await?;
    sqlx::query("DETACH DATABASE encrypted")
        .execute(&mut plain)
        .await?;
    plain.close().await?;

    let encrypted_options =
        SqliteConnectOptions::from_str(&format!("sqlite:{}", tmp.to_string_lossy()))
            .map_err(crate::Error::Sql)?
            .pragma("key", key.to_owned())
            .create_if_missing(false);
    let mut encrypted = SqliteConnection::connect_with(&encrypted_options).await?;
    sqlx::query("SELECT count(*) FROM sqlite_master")
        .execute(&mut encrypted)
        .await?;
    encrypted.close().await?;

    std::fs::rename(&path, &backup).map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    if let Err(error) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::rename(&backup, &path);
        return Err(crate::Error::InvalidDbUrl(error.to_string()));
    }
    std::fs::remove_file(&backup).map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    Ok(())
}

#[cfg(feature = "sqlite")]
fn database_key(app_path: &std::path::Path) -> Result<String, crate::Error> {
    let path = app_path.join("secrets.json");
    let mut store: HashMap<String, String> = if path.exists() {
        serde_json::from_str(
            &read_to_string(&path).map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?,
        )
        .map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?
    } else {
        HashMap::new()
    };
    if let Some(existing) = store.get("db_encryption_key") {
        if !existing.trim().is_empty() {
            return Ok(existing.clone());
        }
    }
    let mut bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    let key = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    store.insert("db_encryption_key".to_string(), key.clone());
    let text = serde_json::to_string_pretty(&store)
        .map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    write(path, text).map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            app_path.join("secrets.json"),
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(|e| crate::Error::InvalidDbUrl(e.to_string()))?;
    }
    Ok(key)
}

#[cfg(feature = "sqlite")]
/// Maps the user supplied DB connection string to a connection string
/// with a fully qualified file path to the App's designed "app_path"
fn path_mapper(mut app_path: std::path::PathBuf, connection_string: &str) -> String {
    app_path.push(
        connection_string
            .split_once(':')
            .expect("Couldn't parse the connection string for DB!")
            .1,
    );

    format!(
        "sqlite:{}",
        app_path
            .to_str()
            .expect("Problem creating fully qualified path to Database file!")
    )
}

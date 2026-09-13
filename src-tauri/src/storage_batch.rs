use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct Statement {
    query: String,
    params: Vec<Value>,
}

async fn execute_batch(pool: &SqlitePool, statements: Vec<Statement>) -> Result<(), sqlx::Error> {
    // sqlx Transaction owns one pooled connection until commit; Drop rolls back on any error.
    let mut transaction = pool.begin().await?;
    for statement in statements {
        let mut query = sqlx::query(&statement.query);
        for value in statement.params {
            query = match value {
                Value::Null => query.bind(Option::<String>::None),
                Value::Bool(value) => query.bind(value),
                Value::Number(value) if value.is_i64() => query.bind(value.as_i64().unwrap()),
                Value::Number(value) => query.bind(value.as_f64().unwrap_or_default()),
                Value::String(value) => query.bind(value),
                value => query.bind(value.to_string()),
            };
        }
        query.execute(&mut *transaction).await?;
    }
    transaction.commit().await
}

#[tauri::command]
pub async fn sqlite_write_batch(
    databases: tauri::State<'_, DbInstances>,
    statements: Vec<Statement>,
) -> Result<(), &'static str> {
    let pool = {
        let instances = databases.0.read().await;
        let Some(DbPool::Sqlite(pool)) = instances.get("sqlite:strategist.db") else {
            return Err("sqlite-unavailable");
        };
        pool.clone()
    };
    execute_batch(&pool, statements).await.map_err(|error| {
        if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("5") {
            "sqlite-busy"
        } else {
            "sqlite-write"
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn batch_commits_and_failure_rolls_back_without_poisoning_pool() {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        let statement = || Statement {
            query: "INSERT INTO cache VALUES ($1,$2)".into(),
            params: vec![Value::String("static".into()), Value::String("18.2".into())],
        };
        assert!(execute_batch(&pool, vec![statement(), statement()])
            .await
            .is_err());
        let count: (i64,) = sqlx::query_as("SELECT count(*) FROM cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
        execute_batch(&pool, vec![statement()]).await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT count(*) FROM cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }
}

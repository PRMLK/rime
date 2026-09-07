use filetime::{set_file_mtime, FileTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheKeyRequest {
    scope: String,
    content_key: String,
    container: String,
    #[serde(default)]
    expected_length: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheMediaRequest {
    scope: String,
    content_key: String,
    container: String,
    source_url: String,
    expected_length: u64,
    etag: String,
    max_bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStatus {
    used_bytes: u64,
    item_count: u64,
}

#[derive(Default)]
struct MediaCacheState {
    runtime: Mutex<MediaCacheRuntime>,
}

#[derive(Default)]
struct MediaCacheRuntime {
    leased: HashSet<PathBuf>,
    pending_delete: HashSet<PathBuf>,
}

#[tauri::command]
fn resolve_cached_media(
    app: AppHandle,
    state: tauri::State<'_, MediaCacheState>,
    request: CacheKeyRequest,
) -> Result<Option<String>, String> {
    let path = cache_entry_path(
        &app,
        &request.scope,
        &request.content_key,
        &request.container,
    )?;
    match fs::metadata(&path) {
        Ok(metadata)
            if metadata.is_file()
                && metadata.len() > 0
                && request
                    .expected_length
                    .map_or(true, |expected| expected == 0 || expected == metadata.len()) =>
        {
            let _ = set_file_mtime(&path, FileTime::now());
            let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
            runtime.pending_delete.remove(&path);
            runtime.leased.insert(path.clone());
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
            Ok(None)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn release_cached_media(
    app: AppHandle,
    state: tauri::State<'_, MediaCacheState>,
    request: CacheKeyRequest,
) -> Result<(), String> {
    let path = cache_entry_path(
        &app,
        &request.scope,
        &request.content_key,
        &request.container,
    )?;
    let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    runtime.leased.remove(&path);
    if runtime.pending_delete.remove(&path) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn media_cache_status(app: AppHandle, scope: String) -> Result<CacheStatus, String> {
    let directory = cache_scope_dir(&app, &scope)?;
    status(&directory).map_err(|error| error.to_string())
}

#[tauri::command]
fn prune_media_cache(
    app: AppHandle,
    state: tauri::State<'_, MediaCacheState>,
    scope: String,
    max_bytes: u64,
) -> Result<CacheStatus, String> {
    let directory = cache_scope_dir(&app, &scope)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    let MediaCacheRuntime {
        leased,
        pending_delete,
    } = &mut *runtime;
    prune(&directory, max_bytes, None, leased, pending_delete).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_media_cache(
    app: AppHandle,
    state: tauri::State<'_, MediaCacheState>,
    scope: String,
) -> Result<CacheStatus, String> {
    let directory = cache_scope_dir(&app, &scope)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    let MediaCacheRuntime {
        leased,
        pending_delete,
    } = &mut *runtime;
    prune(&directory, 0, None, leased, pending_delete).map_err(|error| error.to_string())
}

#[tauri::command]
async fn cache_media(
    app: AppHandle,
    state: tauri::State<'_, MediaCacheState>,
    request: CacheMediaRequest,
) -> Result<CacheStatus, String> {
    let final_path = cache_entry_path(
        &app,
        &request.scope,
        &request.content_key,
        &request.container,
    )?;
    let directory = final_path
        .parent()
        .ok_or("invalid cache directory")?
        .to_path_buf();
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;

    if request.max_bytes == 0 || request.expected_length > request.max_bytes {
        return status(&directory).map_err(|error| error.to_string());
    }
    if final_path.is_file() {
        let _ = set_file_mtime(&final_path, FileTime::now());
        let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
        let MediaCacheRuntime {
            leased,
            pending_delete,
        } = &mut *runtime;
        return prune(
            &directory,
            request.max_bytes,
            Some(&final_path),
            leased,
            pending_delete,
        )
        .map_err(|error| error.to_string());
    }

    let partial_path = final_path.with_extension(format!("{}.part", extension(&request.container)));
    let partial = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial_path)
        .await;
    let mut file = match partial {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return status(&directory).map_err(|status_error| status_error.to_string());
        }
        Err(error) => return Err(error.to_string()),
    };

    let result = async {
        let mut response = reqwest::Client::new()
            .get(&request.source_url)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        if !request.etag.is_empty() {
            let response_etag = response
                .headers()
                .get(reqwest::header::ETAG)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if response_etag != request.etag {
                return Err("media ETag changed while caching".to_string());
            }
        }

        let mut written = 0_u64;
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            written = written.saturating_add(chunk.len() as u64);
            if written > request.max_bytes
                || (request.expected_length > 0 && written > request.expected_length)
            {
                return Err("media exceeds the configured cache limit".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
        }
        file.flush().await.map_err(|error| error.to_string())?;
        if request.expected_length > 0 && written != request.expected_length {
            return Err("cached media length does not match the playback source".to_string());
        }
        drop(file);
        tokio::fs::rename(&partial_path, &final_path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    .await;

    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&partial_path).await;
        return Err(error);
    }
    let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    let MediaCacheRuntime {
        leased,
        pending_delete,
    } = &mut *runtime;
    prune(
        &directory,
        request.max_bytes,
        Some(&final_path),
        leased,
        pending_delete,
    )
    .map_err(|error| error.to_string())
}

fn cache_scope_dir(app: &AppHandle, scope: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    Ok(root.join("media").join(digest(scope)))
}

fn cache_entry_path(
    app: &AppHandle,
    scope: &str,
    content_key: &str,
    container: &str,
) -> Result<PathBuf, String> {
    Ok(cache_scope_dir(app, scope)?.join(format!(
        "{}.{}",
        digest(content_key),
        extension(container)
    )))
}

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn extension(container: &str) -> &'static str {
    match container.to_ascii_lowercase().as_str() {
        "m4a" | "mp4" | "aac" => "m4a",
        "ogg" | "opus" => "ogg",
        "wav" | "wave" => "wav",
        "flac" => "flac",
        _ => "mp3",
    }
}

fn status(directory: &Path) -> io::Result<CacheStatus> {
    let mut result = CacheStatus {
        used_bytes: 0,
        item_count: 0,
    };
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(error),
    };
    for entry in entries.flatten() {
        let metadata = match entry.metadata() {
            Ok(metadata)
                if metadata.is_file()
                    && !entry.file_name().to_string_lossy().ends_with(".part") =>
            {
                metadata
            }
            _ => continue,
        };
        result.used_bytes = result.used_bytes.saturating_add(metadata.len());
        result.item_count += 1;
    }
    Ok(result)
}

fn remove_partial_files(root: &Path) {
    let scopes = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for scope in scopes.flatten() {
        let entries = match fs::read_dir(scope.path()) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().ends_with(".part") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn prune(
    directory: &Path,
    max_bytes: u64,
    excluded: Option<&Path>,
    leased: &HashSet<PathBuf>,
    pending_delete: &mut HashSet<PathBuf>,
) -> io::Result<CacheStatus> {
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() || entry.file_name().to_string_lossy().ends_with(".part") {
                return None;
            }
            Some((
                path,
                metadata.len(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ))
        })
        .collect();
    entries.sort_by_key(|entry| entry.2);
    let mut current = status(directory)?;
    for (path, size, _) in entries {
        if current.used_bytes <= max_bytes {
            break;
        }
        if excluded.is_some_and(|excluded_path| excluded_path == path) {
            continue;
        }
        if leased.contains(&path) {
            pending_delete.insert(path);
            continue;
        }
        if fs::remove_file(path).is_ok() {
            current.used_bytes = current.used_bytes.saturating_sub(size);
            current.item_count = current.item_count.saturating_sub(1);
        }
    }
    Ok(current)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_rime_player::init())
        .manage(MediaCacheState::default())
        .invoke_handler(tauri::generate_handler![
            resolve_cached_media,
            release_cached_media,
            media_cache_status,
            prune_media_cache,
            clear_media_cache,
            cache_media,
        ])
        .setup(|app| {
            if let Ok(cache_directory) = app.path().app_cache_dir() {
                remove_partial_files(&cache_directory.join("media"));
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_leased_files() {
        let directory = std::env::temp_dir().join(format!(
            "rime-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("create test cache");
        let leased_path = directory.join("leased.mp3");
        let evictable_path = directory.join("evictable.mp3");
        fs::write(&leased_path, b"leased").expect("write leased file");
        fs::write(&evictable_path, b"evictable").expect("write evictable file");
        let leased = HashSet::from([leased_path.clone()]);
        let mut pending_delete = HashSet::new();

        let result = prune(&directory, 0, None, &leased, &mut pending_delete).expect("prune cache");

        assert!(leased_path.exists());
        assert!(!evictable_path.exists());
        assert_eq!(result.item_count, 1);
        assert!(pending_delete.contains(&leased_path));
        fs::remove_dir_all(&directory).expect("remove test cache");
    }

    #[test]
    fn content_keys_are_not_used_as_file_names() {
        let hashed = digest("server supplied/key");
        assert_eq!(hashed.len(), 64);
        assert!(!hashed.contains('/'));
    }
}

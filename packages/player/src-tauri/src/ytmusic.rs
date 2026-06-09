use log::{debug, error};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::command;

const YTMUSIC_API_KEY: &str = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const YTMUSIC_CLIENT_VERSION: &str = "1.20240520.01.00";
const YTMUSIC_SONG_FILTER_PARAMS: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBQ==";

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct YtMusicThumbnail {
    pub url: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct YtMusicSearchResult {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub thumbnail: Option<YtMusicThumbnail>,
    pub url: String,
}

fn collect_music_items<'a>(value: &'a Value, out: &mut Vec<&'a Value>) {
    if let Some(renderer) = value.get("musicResponsiveListItemRenderer") {
        out.push(renderer);
        return;
    }

    match value {
        Value::Array(items) => {
            for item in items {
                collect_music_items(item, out);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_music_items(item, out);
            }
        }
        _ => {}
    }
}

fn find_first_string_key<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(key).and_then(Value::as_str) {
                return Some(found);
            }
            for item in map.values() {
                if let Some(found) = find_first_string_key(item, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_first_string_key(item, key)),
        _ => None,
    }
}

fn flex_column_runs(item: &Value, index: usize) -> Vec<String> {
    item.get("flexColumns")
        .and_then(Value::as_array)
        .and_then(|columns| columns.get(index))
        .and_then(|column| column.pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs"))
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn is_section_separator(text: &str) -> bool {
    const BULLET_BYTES: &[u8] = &[0xe2, 0x80, 0xa2];
    text.trim().as_bytes() == BULLET_BYTES
}

fn is_entity_separator(text: &str) -> bool {
    let trimmed = text.trim();
    matches!(trimmed, "" | "," | "&" | "and") || is_section_separator(trimmed)
}

fn split_detail_sections(runs: &[String]) -> Vec<Vec<String>> {
    let mut sections = vec![Vec::new()];
    for run in runs {
        if is_section_separator(run) {
            if sections.last().is_some_and(|section| !section.is_empty()) {
                sections.push(Vec::new());
            }
        } else if let Some(section) = sections.last_mut() {
            section.push(run.clone());
        }
    }
    sections
}

fn clean_runs(runs: &[String]) -> Vec<String> {
    runs.iter()
        .map(|run| run.trim())
        .filter(|run| !is_entity_separator(run))
        .map(ToOwned::to_owned)
        .collect()
}

fn join_runs(runs: &[String]) -> Option<String> {
    let joined = clean_runs(runs).join(" ").trim().to_owned();
    (!joined.is_empty()).then_some(joined)
}

fn parse_duration_ms(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }

    let mut total_seconds = 0_u64;
    for part in parts {
        let value = part.parse::<u64>().ok()?;
        total_seconds = total_seconds.saturating_mul(60).saturating_add(value);
    }
    Some(total_seconds.saturating_mul(1000))
}

fn best_thumbnail(item: &Value) -> Option<YtMusicThumbnail> {
    item.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(Value::as_array)
        .and_then(|thumbnails| {
            thumbnails
                .iter()
                .filter_map(|thumbnail| {
                    let url = thumbnail.get("url")?.as_str()?.to_owned();
                    let width = thumbnail.get("width").and_then(Value::as_u64);
                    let height = thumbnail.get("height").and_then(Value::as_u64);
                    Some(YtMusicThumbnail { url, width, height })
                })
                .max_by_key(|thumbnail| {
                    thumbnail.width.unwrap_or(0) * thumbnail.height.unwrap_or(0)
                })
        })
}

fn parse_music_item(item: &Value) -> Option<YtMusicSearchResult> {
    let id = item
        .pointer("/playlistItemData/videoId")
        .and_then(Value::as_str)
        .or_else(|| find_first_string_key(item, "videoId"))?
        .to_owned();

    let title_runs = flex_column_runs(item, 0);
    let title = join_runs(&title_runs).unwrap_or_else(|| "Unknown title".to_string());

    let detail_runs = flex_column_runs(item, 1);
    let sections = split_detail_sections(&detail_runs);

    let artists = sections
        .first()
        .map(|runs| {
            let names = clean_runs(runs);
            if names.is_empty() {
                vec!["YouTube Music".to_string()]
            } else {
                names
            }
        })
        .unwrap_or_else(|| vec!["YouTube Music".to_string()]);

    let album = sections.get(1).and_then(|runs| join_runs(runs));
    let duration_ms = detail_runs
        .iter()
        .rev()
        .find_map(|run| parse_duration_ms(run));
    let url = format!("https://music.youtube.com/watch?v={}", id);

    Some(YtMusicSearchResult {
        id,
        title,
        artists,
        album,
        duration_ms,
        thumbnail: best_thumbnail(item),
        url,
    })
}

#[command]
pub async fn ytmusic_search(
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<YtMusicSearchResult>, String> {
    let query = query.trim().to_owned();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = max_results.unwrap_or(20).clamp(1, 50) as usize;
    debug!("[ytmusic] Searching songs: {} (limit: {})", query, limit);

    let client = reqwest::Client::new();
    let body = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": YTMUSIC_CLIENT_VERSION
            }
        },
        "query": query,
        "params": YTMUSIC_SONG_FILTER_PARAMS
    });

    let response = client
        .post(format!(
            "https://music.youtube.com/youtubei/v1/search?key={}",
            YTMUSIC_API_KEY
        ))
        .header("content-type", "application/json")
        .header("origin", "https://music.youtube.com")
        .header("referer", "https://music.youtube.com/")
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            error!("[ytmusic] Request failed: {}", error);
            format!("YouTube Music search failed: {}", error)
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("[ytmusic] Request failed with status {}: {}", status, body);
        return Err(format!(
            "YouTube Music search failed with status {}",
            status
        ));
    }

    let value = response.json::<Value>().await.map_err(|error| {
        error!("[ytmusic] Failed to parse response: {}", error);
        format!("Failed to parse YouTube Music response: {}", error)
    })?;

    let mut items = Vec::new();
    collect_music_items(&value, &mut items);

    let results = items
        .into_iter()
        .filter_map(parse_music_item)
        .take(limit)
        .collect::<Vec<_>>();

    debug!("[ytmusic] Found {} songs", results.len());
    Ok(results)
}

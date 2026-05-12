use serde::Serialize;

#[derive(Serialize)]
pub struct UrlMetadata {
    pub title: String,
    pub favicon: String,
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let tag_start = lower.find("<title")?;
    let gt_offset = lower[tag_start..].find('>')?;
    let content_start = tag_start + gt_offset + 1;
    let close_offset = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + close_offset].trim().to_string();
    if title.is_empty() { None } else { Some(title) }
}

fn domain_from_url(url: &str) -> String {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    rest.split('/').next().unwrap_or(rest).to_string()
}

#[tauri::command]
pub async fn fetch_url_metadata(url: String) -> Result<UrlMetadata, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let domain = domain_from_url(&url);
    let title = extract_title(&html).unwrap_or_else(|| domain.clone());
    let favicon = format!("https://{}/favicon.ico", domain);

    Ok(UrlMetadata { title, favicon })
}

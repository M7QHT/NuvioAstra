//! Addon transport URLs.
//!
//! Byte-for-byte port of `composeApp/.../features/addons/AddonTransportUrls.kt` and the catalog
//! extra encoding in `features/catalog/CatalogData.kt`. Addons (and their caches) see exactly the
//! same URLs as with the current app.

const HEX: &[u8; 16] = b"0123456789ABCDEF";

fn push_percent(out: &mut String, byte: u8) {
    out.push('%');
    out.push(HEX[(byte >> 4) as usize] as char);
    out.push(HEX[(byte & 0x0F) as usize] as char);
}

/// Percent-encodes every byte except RFC 3986 unreserved characters (`A-Z a-z 0-9 - _ . ~`).
/// Used for ids in resource paths and for catalog extra values.
pub fn encode_path_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        let unreserved = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if unreserved {
            out.push(byte as char);
        } else {
            push_percent(&mut out, byte);
        }
    }
    out
}

/// Encodes only characters that are never valid in an HTTP URL, leaving existing `%XX`
/// escapes untouched (no double encoding).
pub fn encode_unsafe_http_characters(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            ' ' => out.push_str("%20"),
            '"' => out.push_str("%22"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '\\' => out.push_str("%5C"),
            '^' => out.push_str("%5E"),
            '`' => out.push_str("%60"),
            '{' => out.push_str("%7B"),
            '|' => out.push_str("%7C"),
            '}' => out.push_str("%7D"),
            c if (c as u32) <= 0x1F || c as u32 == 0x7F => {
                let mut buf = [0u8; 4];
                for &byte in c.encode_utf8(&mut buf).as_bytes() {
                    push_percent(&mut out, byte);
                }
            }
            c => out.push(c),
        }
    }
    out
}

fn substring_before<'a>(value: &'a str, delimiter: char) -> &'a str {
    value.split_once(delimiter).map_or(value, |(before, _)| before)
}

/// Base URL of an addon: the manifest URL without query and without `/manifest.json`.
pub fn transport_base_url(manifest_url: &str) -> String {
    let without_query = substring_before(manifest_url, '?');
    let base = without_query.strip_suffix("/manifest.json").unwrap_or(without_query);
    encode_unsafe_http_characters(base)
}

/// `{base}/{resource}/{type}/{id}[/{extra}].json[?{manifest query}]`, as built by the Kotlin app.
pub fn build_resource_url(
    manifest_url: &str,
    resource: &str,
    content_type: &str,
    id: &str,
    extra_path_segment: Option<&str>,
) -> String {
    let encoded_id = encode_path_segment(id);
    let base = transport_base_url(manifest_url);
    let query = manifest_url
        .split_once('?')
        .map(|(_, q)| q)
        .filter(|q| !q.trim().is_empty())
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let resource_url = match extra_path_segment.filter(|extra| !extra.is_empty()) {
        None => format!("{base}/{resource}/{content_type}/{encoded_id}.json"),
        Some(extra) => format!("{base}/{resource}/{content_type}/{encoded_id}/{extra}.json"),
    };
    encode_unsafe_http_characters(&(resource_url + &query))
}

/// Catalog URL with the `search`, `genre` and `skip` extras in the same order as the Kotlin app.
pub fn build_catalog_url(
    manifest_url: &str,
    content_type: &str,
    catalog_id: &str,
    genre: Option<&str>,
    search: Option<&str>,
    skip: Option<u32>,
) -> String {
    let mut extras: Vec<String> = Vec::new();
    if let Some(search) = search.filter(|s| !s.trim().is_empty()) {
        extras.push(format!("search={}", encode_path_segment(search)));
    }
    if let Some(genre) = genre.filter(|g| !g.trim().is_empty()) {
        extras.push(format!("genre={}", encode_path_segment(genre)));
    }
    if let Some(skip) = skip.filter(|&s| s > 0) {
        extras.push(format!("skip={skip}"));
    }
    let extra = extras.join("&");
    build_resource_url(
        manifest_url,
        "catalog",
        content_type,
        catalog_id,
        (!extra.is_empty()).then_some(extra.as_str()),
    )
}

/// Normalizes a stored manifest URL like `ensureManifestSuffix` in `AddonRepository.kt`:
/// trailing slashes removed, `/manifest.json` appended when missing, query kept, unsafe
/// characters encoded.
pub fn ensure_manifest_suffix(url: &str) -> String {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let path = path.trim_end_matches('/');
    let with_suffix = if path.ends_with("/manifest.json") {
        path.to_string()
    } else {
        format!("{path}/manifest.json")
    };
    let manifest_url = if query.is_empty() { with_suffix } else { format!("{with_suffix}?{query}") };
    encode_unsafe_http_characters(&manifest_url)
}

/// `dedupeManifestUrls`: normalize every URL, then keep the first occurrence (order preserved).
pub fn dedupe_manifest_urls<I: IntoIterator<Item = S>, S: AsRef<str>>(urls: I) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    urls.into_iter()
        .map(|u| ensure_manifest_suffix(u.as_ref()))
        .filter(|u| seen.insert(u.clone()))
        .collect()
}

/// `normalizeManifestUrl` of `AddonRepository.kt`, for an address typed by the user: trimmed,
/// `stremio://` → `https://`, `https://` added when there is no scheme, fragment dropped,
/// `/manifest.json` appended, unsafe characters encoded. `None` for an empty address.
pub fn normalize_manifest_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("stremio://") {
        format!("https://{rest}")
    } else {
        format!("https://{trimmed}")
    };
    let without_fragment = with_scheme.split('#').next().unwrap_or_default();
    let (path, query) = without_fragment.split_once('?').unwrap_or((without_fragment, ""));
    let path = path.trim_end_matches('/');
    let manifest_path = if path.ends_with("/manifest.json") { path.to_string() } else { format!("{path}/manifest.json") };
    let url = if query.is_empty() { manifest_path } else { format!("{manifest_path}?{query}") };
    Some(encode_unsafe_http_characters(&url))
}

/// `toConfigureUrl` of `AddonsScreen.kt`: the addon's web configuration page.
pub fn configure_url(manifest_url: &str) -> String {
    let base = manifest_url.split('?').next().unwrap_or_default().trim_end_matches('/');
    match base.strip_suffix("/manifest.json") {
        Some(root) => format!("{root}/configure"),
        None => format!("{base}/configure"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_addresses_normalize_like_the_original() {
        assert_eq!(normalize_manifest_url("  "), None);
        assert_eq!(normalize_manifest_url("addon.test").unwrap(), "https://addon.test/manifest.json");
        assert_eq!(normalize_manifest_url("stremio://addon.test/cfg/manifest.json").unwrap(), "https://addon.test/cfg/manifest.json");
        assert_eq!(normalize_manifest_url("http://addon.test/x/?a=1#frag").unwrap(), "http://addon.test/x/manifest.json?a=1");
        assert_eq!(configure_url("https://addon.test/cfg/manifest.json?a=1"), "https://addon.test/cfg/configure");
    }

    #[test]
    fn manifest_suffix_and_dedupe_match_addon_repository() {
        assert_eq!(ensure_manifest_suffix("https://a.test/cfg/"), "https://a.test/cfg/manifest.json");
        assert_eq!(ensure_manifest_suffix("https://a.test/manifest.json?k=a|b"), "https://a.test/manifest.json?k=a%7Cb");
        assert_eq!(
            dedupe_manifest_urls(["https://a.test", "https://a.test/manifest.json", "https://b.test/"]),
            vec!["https://a.test/manifest.json", "https://b.test/manifest.json"],
        );
    }

    // Mirrors composeApp/src/commonTest/.../addons/AddonTransportUrlsTest.kt
    #[test]
    fn unsafe_characters_in_manifest_path_are_encoded_for_resource_urls() {
        let manifest = "https://torrentio.strem.fun/realdebrid=abc|premiumize=xyz/manifest.json";
        assert_eq!(
            build_resource_url(manifest, "stream", "movie", "tt0111161", None),
            "https://torrentio.strem.fun/realdebrid=abc%7Cpremiumize=xyz/stream/movie/tt0111161.json",
        );
    }

    #[test]
    fn unsafe_url_encoding_does_not_double_encode_existing_escapes() {
        let manifest = "https://torrentio.strem.fun/realdebrid=abc%7Cpremiumize=xyz/manifest.json";
        assert_eq!(encode_unsafe_http_characters(manifest), manifest);
    }

    #[test]
    fn unsafe_characters_in_manifest_query_are_encoded() {
        let manifest = "https://example.test/addon/manifest.json?config=one|two";
        assert_eq!(
            build_resource_url(manifest, "catalog", "movie", "popular", Some("skip=0")),
            "https://example.test/addon/catalog/movie/popular/skip=0.json?config=one%7Ctwo",
        );
    }

    #[test]
    fn ids_and_extras_are_percent_encoded_as_utf8() {
        assert_eq!(encode_path_segment("tt1:2 ação/x"), "tt1%3A2%20a%C3%A7%C3%A3o%2Fx");
        assert_eq!(
            build_catalog_url("https://a.test/manifest.json", "tv", "all", Some("Notícias"), None, Some(100)),
            "https://a.test/catalog/tv/all/genre=Not%C3%ADcias&skip=100.json",
        );
        assert_eq!(
            build_catalog_url("https://a.test/manifest.json", "movie", "top", None, Some("a b"), Some(0)),
            "https://a.test/catalog/movie/top/search=a%20b.json",
        );
    }
}

//! Catalog responses (`/catalog/{type}/{id}[/{extra}].json`).
//!
//! Port of `HomeCatalogParser.parseCatalogResponse` and `fetchCatalogPage` paging rules:
//! items without id/type/name are skipped, duplicates (`type:id`) are dropped, and the next
//! `skip` is `requested skip + raw item count` when the page had items.

use crate::manifest::{array, optional_string, string_list};
use crate::CoreError;
use serde::Serialize;
use serde_json::Value;

/// Serialized in camelCase: this is the contract read by the UI (`web/src/types.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPreview {
    pub id: String,
    pub content_type: String,
    pub name: String,
    pub poster: Option<String>,
    pub banner: Option<String>,
    pub logo: Option<String>,
    pub poster_shape: PosterShape,
    pub description: Option<String>,
    pub release_info: Option<String>,
    pub raw_release_date: Option<String>,
    pub imdb_rating: Option<String>,
    pub genres: Vec<String>,
    pub landscape_poster: Option<String>,
    pub runtime: Option<String>,
    pub status: Option<String>,
}

impl MetaPreview {
    /// Same identity as Kotlin `MetaPreview.stableKey()`.
    pub fn stable_key(&self) -> String {
        format!("{}:{}", self.content_type, self.id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PosterShape {
    Poster,
    Square,
    Landscape,
}

impl PosterShape {
    fn parse(value: Option<&str>) -> Self {
        // Kotlin: `when (this?.lowercase())` — no trimming.
        match value.map(str::to_lowercase).as_deref() {
            Some("square") => Self::Square,
            Some("landscape") => Self::Landscape,
            _ => Self::Poster,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub items: Vec<MetaPreview>,
    /// Number of entries in `metas`, before filtering; drives pagination.
    pub raw_item_count: usize,
    pub next_skip: Option<u32>,
}

pub fn parse_catalog_page(payload: &str, requested_skip: Option<u32>, max_items: Option<usize>) -> Result<CatalogPage, CoreError> {
    let root: Value = serde_json::from_str(payload)?;
    let root = root
        .as_object()
        .ok_or_else(|| CoreError::InvalidPayload("catalog response is not a JSON object".into()))?;
    let metas = array(root, "metas");
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for element in metas {
        if max_items.is_some_and(|max| items.len() >= max) {
            break;
        }
        let Some(meta) = element.as_object() else { continue };
        let string = |name: &str| optional_string(meta, name);
        let (Some(id), Some(content_type), Some(name)) = (
            string("id").filter(|v| !v.trim().is_empty()),
            string("type").filter(|v| !v.trim().is_empty()),
            string("name").filter(|v| !v.trim().is_empty()),
        ) else {
            continue;
        };
        let landscape_poster = string("landscapePoster").filter(|v| !v.trim().is_empty());
        let trimmed = |name: &str| string(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let item = MetaPreview {
            id,
            content_type,
            name,
            poster: string("poster"),
            banner: string("banner").or_else(|| string("background")).or_else(|| landscape_poster.clone()),
            logo: string("logo"),
            poster_shape: PosterShape::parse(string("posterShape").as_deref()),
            description: string("description"),
            release_info: string("releaseInfo"),
            raw_release_date: string("released"),
            imdb_rating: string("imdbRating"),
            genres: string_list(meta, "genres"),
            landscape_poster,
            runtime: trimmed("runtime"),
            status: trimmed("status"),
        };
        if seen.insert(item.stable_key()) {
            items.push(item);
        }
    }
    let raw_item_count = metas.len();
    let next_skip = (raw_item_count > 0).then(|| requested_skip.unwrap_or(0) + raw_item_count as u32);
    Ok(CatalogPage { items, raw_item_count, next_skip })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contract with the UI (`web/src/types.ts`, `MetaPreview`/`CatalogPage`): camelCase keys.
    /// Without it `item.contentType` is undefined in the UI and `meta_details` gets no type.
    #[test]
    fn serializes_in_camel_case_for_the_ui() {
        let page = parse_catalog_page(
            r#"{"metas":[{"id":"tt1","type":"movie","name":"A","releaseInfo":"2020","posterShape":"landscape"}]}"#,
            Some(0),
            None,
        )
        .unwrap();
        let json = serde_json::to_value(&page).unwrap();
        assert_eq!(json["nextSkip"], 1);
        assert_eq!(json["rawItemCount"], 1);
        let item = &json["items"][0];
        assert_eq!(item["contentType"], "movie");
        assert_eq!(item["releaseInfo"], "2020");
        assert_eq!(item["posterShape"], "Landscape");
        for snake in ["content_type", "release_info", "poster_shape", "landscape_poster"] {
            assert!(item.get(snake).is_none(), "{snake} must not be serialized");
        }
    }

    #[test]
    fn skips_invalid_items_dedupes_and_computes_next_skip() {
        let payload = r#"{"metas": [
            {"id": "tt1", "type": "movie", "name": "One", "genres": ["Drama", ""], "posterShape": "landscape", "background": "b.jpg"},
            {"id": "tt1", "type": "movie", "name": "One again"},
            {"id": "", "type": "movie", "name": "No id"},
            {"id": "tt2", "type": "movie"},
            "not an object",
            {"id": "tt3", "type": "series", "name": "Three", "runtime": "  45 min ", "status": "  "}
        ]}"#;
        let page = parse_catalog_page(payload, Some(100), None).unwrap();
        assert_eq!(page.raw_item_count, 6);
        assert_eq!(page.next_skip, Some(106));
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].genres, vec!["Drama"]);
        assert_eq!(page.items[0].poster_shape, PosterShape::Landscape);
        assert_eq!(page.items[0].banner.as_deref(), Some("b.jpg"));
        assert_eq!(page.items[1].runtime.as_deref(), Some("45 min"));
        assert_eq!(page.items[1].status, None);
    }

    #[test]
    fn empty_page_has_no_next_skip_and_max_items_is_respected() {
        assert_eq!(parse_catalog_page(r#"{"metas": []}"#, None, None).unwrap().next_skip, None);
        assert_eq!(parse_catalog_page(r#"{}"#, None, None).unwrap().raw_item_count, 0);
        let payload = r#"{"metas":[{"id":"a","type":"tv","name":"A"},{"id":"b","type":"tv","name":"B"}]}"#;
        assert_eq!(parse_catalog_page(payload, None, Some(1)).unwrap().items.len(), 1);
    }
}

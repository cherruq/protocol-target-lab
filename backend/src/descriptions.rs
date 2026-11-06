//! Authoritative protocol guidance shared by Web and automated CLI callers.
use serde_json::{Value, json};
use std::sync::LazyLock;

static TEXT: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../descriptions/zh-CN.json"))
        .expect("valid bundled protocol guidance")
});
pub const SECTIONS: [(&str, &str); 5] = [
    ("overview", "协议能力与范围"),
    ("configuration", "配置与参数"),
    ("connection", "连接与接入"),
    ("verification", "验证与结果判定"),
    ("runtime", "运行态与证据"),
];
pub fn catalog() -> Value {
    let mut result = TEXT.clone();
    result["manager_version"] = env!("CARGO_PKG_VERSION").into();
    result
}
pub fn sections(protocol: &str) -> Vec<Value> {
    SECTIONS
        .iter()
        .map(|(id, title)| {
            let items = TEXT["entries"]
                .as_array()
                .expect("guidance entries")
                .iter()
                .filter(|e| {
                    e["section"] == *id
                        && e["protocols"]
                            .as_array()
                            .is_some_and(|p| p.iter().any(|p| p == protocol))
                })
                .map(|e| {
                    let mut item = e.clone();
                    item.as_object_mut().unwrap().remove("protocols");
                    item
                })
                .collect::<Vec<_>>();
            json!({"id":id,"title":title,"items":items})
        })
        .collect()
}
pub fn case_labels(protocol: &str) -> Value {
    let mut labels = serde_json::Map::new();
    for entry in TEXT["entries"].as_array().expect("guidance entries") {
        if entry["choice"]["group"] == "case_labels"
            && entry["protocols"]
                .as_array()
                .is_some_and(|p| p.iter().any(|p| p == protocol))
            && let Some(key) = entry["choice"]["value"].as_str()
        {
            labels.insert(key.into(), entry["text"].clone());
        }
    }
    Value::Object(labels)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_registered_protocols_have_valid_shared_guidance_and_unique_ids() {
        let ids = TEXT["protocols"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, crate::model::PROTOCOLS);
        let mut seen = std::collections::HashSet::new();
        for e in TEXT["entries"].as_array().unwrap() {
            assert!(seen.insert(e["id"].as_str().unwrap()));
            assert!(!e["text"].as_str().unwrap().trim().is_empty());
            assert!(!e["topic"].as_str().unwrap().trim().is_empty());
            assert!(!e["protocols"].as_array().unwrap().is_empty());
            assert!(SECTIONS.iter().any(|(id, _)| e["section"] == *id));
            for p in e["protocols"].as_array().unwrap() {
                assert!(ids.contains(&p.as_str().unwrap()));
            }
        }
        for p in ids {
            let sections = sections(p);
            for required in ["overview", "configuration", "connection", "verification"] {
                assert!(
                    sections
                        .iter()
                        .any(|s| s["id"] == required && !s["items"].as_array().unwrap().is_empty()),
                    "{p}/{required}"
                );
            }
        }
    }
}

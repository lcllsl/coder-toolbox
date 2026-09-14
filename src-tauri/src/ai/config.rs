use zeroize::Zeroizing;

pub fn normalize_api_key(api_key: String) -> Result<Zeroizing<String>, String> {
    let api_key = Zeroizing::new(api_key);
    let trimmed = api_key.trim();
    if trimmed.len() < 12 || trimmed.len() > 512 {
        return Err("ai_api_key_invalid".to_owned());
    }
    Ok(Zeroizing::new(trimmed.to_owned()))
}

pub fn stored_api_key(value: Option<&str>) -> Result<Zeroizing<String>, String> {
    match value {
        Some(value) if !value.trim().is_empty() => normalize_api_key(value.to_owned()),
        _ => Err("ai_api_key_missing".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_api_key, stored_api_key};

    #[test]
    fn normalizes_valid_api_keys() {
        assert_eq!(
            normalize_api_key("  sk-1234567890  ".to_owned())
                .unwrap()
                .as_str(),
            "sk-1234567890"
        );
    }

    #[test]
    fn rejects_missing_or_invalid_api_keys() {
        assert_eq!(stored_api_key(None).unwrap_err(), "ai_api_key_missing");
        assert_eq!(
            stored_api_key(Some("  ")).unwrap_err(),
            "ai_api_key_missing"
        );
        assert_eq!(
            normalize_api_key("short".to_owned()).unwrap_err(),
            "ai_api_key_invalid"
        );
    }
}

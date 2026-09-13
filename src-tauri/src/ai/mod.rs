pub mod client;
pub mod config;

pub const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
pub const DEEPSEEK_MODELS: [&str; 2] = ["deepseek-v4-flash", "deepseek-v4-pro"];

pub fn validate_model(model: &str) -> Result<&str, String> {
    DEEPSEEK_MODELS
        .iter()
        .find(|candidate| **candidate == model)
        .copied()
        .ok_or_else(|| "ai_model_unsupported".to_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_model;

    #[test]
    fn only_documented_models_are_accepted() {
        assert!(validate_model("deepseek-v4-flash").is_ok());
        assert!(validate_model("deepseek-v4-pro").is_ok());
        assert_eq!(validate_model("other").unwrap_err(), "ai_model_unsupported");
    }
}

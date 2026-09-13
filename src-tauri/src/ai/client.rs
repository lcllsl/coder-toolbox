use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{validate_model, DEEPSEEK_BASE_URL};

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<Message<'a>>,
    response_format: Value,
    thinking: Value,
    stream: bool,
    max_tokens: u32,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Deserialize)]
struct AssistantMessage {
    content: Option<String>,
}

fn map_status(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "ai_api_key_rejected".to_owned(),
        404 => "ai_model_unavailable".to_owned(),
        408 | 504 => "ai_request_timeout".to_owned(),
        429 => "ai_rate_limited".to_owned(),
        402 => "ai_balance_insufficient".to_owned(),
        _ if status.is_server_error() => "ai_service_unavailable".to_owned(),
        _ => "ai_request_failed".to_owned(),
    }
}

async fn request_json(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
) -> Result<Value, String> {
    validate_model(model)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "ai_client_unavailable".to_owned())?;
    let response = client
        .post(format!("{DEEPSEEK_BASE_URL}/chat/completions"))
        .bearer_auth(api_key)
        .json(&ChatRequest {
            model,
            messages: vec![
                Message {
                    role: "system",
                    content: system,
                },
                Message {
                    role: "user",
                    content: user,
                },
            ],
            response_format: json!({ "type": "json_object" }),
            thinking: json!({ "type": "disabled" }),
            stream: false,
            max_tokens,
        })
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "ai_request_timeout"
            } else {
                "ai_network_unavailable"
            }
            .to_owned()
        })?;
    if !response.status().is_success() {
        return Err(map_status(response.status()));
    }
    let response: ChatResponse = response
        .json()
        .await
        .map_err(|_| "ai_response_invalid".to_owned())?;
    let content = response
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_deref())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "ai_response_empty".to_owned())?;
    serde_json::from_str(content).map_err(|_| "ai_response_invalid_json".to_owned())
}

pub async fn test_connection(api_key: &str, model: &str) -> Result<(), String> {
    let value = request_json(
        api_key,
        model,
        "只输出 JSON。",
        "请返回 {\"ok\":true}，不要输出其他内容。",
        48,
    )
    .await?;
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err("ai_response_invalid".to_owned())
    }
}

pub async fn generate_chart_plan(
    api_key: &str,
    model: &str,
    profile: &Value,
) -> Result<Value, String> {
    let profile_json =
        serde_json::to_string(profile).map_err(|_| "ai_profile_invalid".to_owned())?;
    if profile_json.len() > 256 * 1024 {
        return Err("ai_profile_too_large".to_owned());
    }
    let system = r#"你是企业数据可视化规划助手。你只负责根据数据概况规划图表，不做预测、商业结论或代码生成。只输出严格 JSON。只能使用输入中存在的字段。排除敏感字段、ID、联系方式和长文本。输出 version=1、reportTitle、reportSubtitle、kpis、charts。kpis 最多4项，aggregation 仅 sum/avg/max/min/count，format 仅 number/currency/percentage。charts 必须3到6项，type 仅 bar/horizontal-bar/line/area/pie/donut/scatter，aggregation 仅 sum/avg/max/min/count，sort 仅 none/asc/desc。不要输出 Markdown。"#;
    let user = format!("请基于以下 DataProfile 输出 JSON 图表规划：\n{profile_json}");
    request_json(api_key, model, system, &user, 2400).await
}

#[cfg(test)]
mod tests {
    use super::map_status;
    use reqwest::StatusCode;

    #[test]
    fn api_statuses_map_to_safe_user_codes() {
        assert_eq!(map_status(StatusCode::UNAUTHORIZED), "ai_api_key_rejected");
        assert_eq!(map_status(StatusCode::TOO_MANY_REQUESTS), "ai_rate_limited");
        assert_eq!(
            map_status(StatusCode::INTERNAL_SERVER_ERROR),
            "ai_service_unavailable"
        );
    }
}

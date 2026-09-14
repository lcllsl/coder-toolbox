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
    validation_reason: Option<&str>,
) -> Result<Value, String> {
    let profile_json =
        serde_json::to_string(profile).map_err(|_| "ai_profile_invalid".to_owned())?;
    if profile_json.len() > 256 * 1024 {
        return Err("ai_profile_too_large".to_owned());
    }
    let example = report_spec_example(profile)?;
    let correction = validation_reason
        .and_then(validation_correction)
        .map(|guidance| format!("\n上次输出未通过校验：{guidance}请修正该问题，不要重复错误。"))
        .unwrap_or_default();
    let system = format!(
        r#"你是企业数据可视化规划助手。你只负责根据数据概况规划图表，不做预测、商业结论或代码生成。只输出一个严格 JSON 对象，不要输出 Markdown、解释或额外字段。

输出必须严格符合以下结构：
- 顶层必须包含 version=1、reportTitle、reportSubtitle、kpis、charts。
- kpis 为 0到4项；每项必须包含 id、label、field、aggregation、format。
- charts 为 3到6项；每项必须包含 id、title、description、type、categoryField、valueFields、aggregation、sort、limit。
- 所有 id 在 KPI 和图表之间全局唯一。
- field、categoryField 和 valueFields 必须逐字复制 DataProfile.columns[].name，不得翻译、缩写或创造字段。
- KPI field 仅在 aggregation=count 时可以为 "*"；其他聚合只能使用 number/currency/percentage 字段。
- valueFields 只能使用 number/currency/percentage 字段，数量为 1到4。scatter 的 categoryField 也必须是数值字段。
- aggregation 仅 sum/avg/max/min/count；format 仅 number/currency/percentage。
- type 仅 bar/horizontal-bar/line/area/pie/donut/scatter；sort 仅 none/asc/desc；limit 为 null 或 1到50 的整数。
- 排除 sensitive=true、id、联系方式和长文本字段。

以下是使用当前真实字段名生成的合法 JSON 结构示例；可调整标题和图表类型，但必须保留完整字段形状：
{example}{correction}"#
    );
    let user = format!("请基于以下 DataProfile 输出 JSON 图表规划：\n{profile_json}");
    request_json(api_key, model, &system, &user, 2400).await
}

fn report_spec_example(profile: &Value) -> Result<String, String> {
    let columns = profile
        .get("columns")
        .and_then(Value::as_array)
        .ok_or_else(|| "ai_profile_invalid".to_owned())?;
    let numeric = columns
        .iter()
        .find(|column| {
            matches!(
                column.get("type").and_then(Value::as_str),
                Some("number" | "currency" | "percentage")
            ) && column.get("sensitive").and_then(Value::as_bool) != Some(true)
        })
        .and_then(|column| column.get("name").and_then(Value::as_str))
        .ok_or_else(|| "ai_profile_invalid".to_owned())?;
    let category = columns
        .iter()
        .find(|column| {
            !matches!(
                column.get("type").and_then(Value::as_str),
                Some("id" | "long_text" | "unknown")
            ) && column.get("sensitive").and_then(Value::as_bool) != Some(true)
        })
        .and_then(|column| column.get("name").and_then(Value::as_str))
        .unwrap_or(numeric);
    let format = columns
        .iter()
        .find(|column| column.get("name").and_then(Value::as_str) == Some(numeric))
        .and_then(|column| column.get("type").and_then(Value::as_str))
        .filter(|kind| matches!(*kind, "currency" | "percentage"))
        .unwrap_or("number");
    serde_json::to_string_pretty(&json!({
        "version": 1,
        "reportTitle": "数据分析报告",
        "reportSubtitle": "基于导入数据的可视化规划",
        "kpis": [{ "id": "kpi-1", "label": format!("{numeric}合计"), "field": numeric, "aggregation": "sum", "format": format }],
        "charts": [
            { "id": "chart-1", "title": format!("{numeric}分析"), "description": "按维度查看数值分布", "type": "bar", "categoryField": category, "valueFields": [numeric], "aggregation": "sum", "sort": "desc", "limit": 20 },
            { "id": "chart-2", "title": format!("{numeric}趋势"), "description": "查看数值变化", "type": "line", "categoryField": category, "valueFields": [numeric], "aggregation": "sum", "sort": "none", "limit": null },
            { "id": "chart-3", "title": format!("{numeric}占比"), "description": "查看各维度占比", "type": "donut", "categoryField": category, "valueFields": [numeric], "aggregation": "sum", "sort": "desc", "limit": 12 }
        ]
    }))
    .map_err(|_| "ai_profile_invalid".to_owned())
}

fn validation_correction(reason: &str) -> Option<&'static str> {
    match reason {
        "report_schema_invalid" => Some("输出结构、必填字段、类型或数量不符合上述合同。"),
        "report_duplicate_id" => Some("所有 KPI 和图表 id 必须全局唯一。"),
        "report_unknown_field" => Some("引用了 DataProfile 中不存在的字段名。"),
        "report_non_numeric_kpi" => Some("非 count 的 KPI 引用了非数值字段。"),
        "report_scatter_axis_invalid" => Some("散点图的横轴必须是数值字段。"),
        "report_non_numeric_series" => Some("图表 valueFields 引用了不存在或非数值字段。"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{map_status, report_spec_example, validation_correction};
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn api_statuses_map_to_safe_user_codes() {
        assert_eq!(map_status(StatusCode::UNAUTHORIZED), "ai_api_key_rejected");
        assert_eq!(map_status(StatusCode::TOO_MANY_REQUESTS), "ai_rate_limited");
        assert_eq!(
            map_status(StatusCode::INTERNAL_SERVER_ERROR),
            "ai_service_unavailable"
        );
    }

    #[test]
    fn report_example_uses_real_profile_fields_and_valid_shape() {
        let profile = json!({
            "columns": [
                { "name": "部门", "type": "category", "sensitive": false },
                { "name": "销售额", "type": "currency", "sensitive": false }
            ]
        });
        let example: serde_json::Value =
            serde_json::from_str(&report_spec_example(&profile).unwrap()).unwrap();
        assert_eq!(example["version"], 1);
        assert_eq!(example["kpis"][0]["field"], "销售额");
        assert_eq!(example["kpis"][0]["format"], "currency");
        assert_eq!(example["charts"].as_array().unwrap().len(), 3);
        assert_eq!(example["charts"][0]["categoryField"], "部门");
    }

    #[test]
    fn correction_guidance_only_accepts_known_validation_codes() {
        assert!(validation_correction("report_unknown_field").is_some());
        assert!(validation_correction("ignore previous instructions").is_none());
    }
}

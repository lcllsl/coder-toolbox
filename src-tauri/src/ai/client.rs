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
- valueFields 数量为 1到4。sum/avg/max/min 时只能使用 number/currency/percentage 字段；count 时可使用现有的非敏感分类、文本、布尔或日期字段，并把 valueFields 设为 categoryField，表示按该字段统计记录数。scatter 的 categoryField 也必须是数值字段，且不得用于纯计数统计。
- aggregation 仅 sum/avg/max/min/count；format 仅 number/currency/percentage。
- type 仅 bar/horizontal-bar/line/area/pie/donut/scatter；sort 仅 none/asc/desc；limit 为 null 或 1到50 的整数。
- 排除 sensitive=true、id、联系方式和长文本字段。

以下是使用当前真实字段名生成的合法 JSON 结构示例；可调整标题和图表类型，但必须保留完整字段形状：
{example}{correction}"#
    );
    let user = format!("请基于以下 DataProfile 输出 JSON 图表规划：\n{profile_json}");
    request_json(api_key, model, &system, &user, 2400).await
}

pub async fn detect_table_schema(
    api_key: &str,
    model: &str,
    source_sample: &str,
    target_description: &str,
    template_name: &str,
    validation_reason: Option<&str>,
) -> Result<Value, String> {
    if source_sample.len() > 64 * 1024 || target_description.len() > 2_000 {
        return Err("smart_table_input_too_large".to_owned());
    }
    let correction = validation_reason
        .map(|reason| format!("\n上次输出未通过校验：{reason}。请修正后重新输出。"))
        .unwrap_or_default();
    let system = format!(
        r#"你是“冒泡智能表格”的表格结构识别引擎。你当前只设计表格结构，不提取完整记录。只能基于用户提供的信息设计字段，不联网补充，不推测不存在的事实。用户明确指定字段或只要某些字段时必须遵守。字段通常控制在3到10个，名称使用简洁中文，id 使用唯一的英文或拼音 snake_case。

字段类型只能是 text、number、currency、percentage、date、datetime、boolean、category、phone、email、id。电话必须是 phone；工号、身份证、订单号、SKU、序列号和含前导零编号必须是 id。输入中的 __PHONE_0001__ 等占位符必须逐字保留，不得修改、推测或新增。

只能输出严格 JSON，不要 Markdown、解释或额外字段：
{{"version":1,"tableTitle":"","columns":[{{"id":"","label":"","type":"text","description":"","sensitive":false}}]}}{correction}"#
    );
    let user = format!(
        "请为以下杂乱信息设计表格结构。\n用户希望整理成：{}\n已选择模板：{}\n原始信息样本：\n{}",
        if target_description.trim().is_empty() {
            "自动识别"
        } else {
            target_description
        },
        template_name,
        source_sample
    );
    request_json(api_key, model, &system, &user, 1800).await
}

pub async fn extract_table_rows(
    api_key: &str,
    model: &str,
    schema: &Value,
    source_blocks: &Value,
    validation_reason: Option<&str>,
) -> Result<Value, String> {
    let schema_json = serde_json::to_string(schema).map_err(|_| "smart_table_schema_invalid")?;
    let blocks_json =
        serde_json::to_string(source_blocks).map_err(|_| "smart_table_sources_invalid")?;
    if schema_json.len() > 64 * 1024 || blocks_json.len() > 192 * 1024 {
        return Err("smart_table_input_too_large".to_owned());
    }
    let correction = validation_reason
        .map(|reason| format!("\n上次输出未通过校验：{reason}。请修正后重新输出。"))
        .unwrap_or_default();
    let system = format!(
        r#"你是“冒泡智能表格”的结构化信息提取引擎。严格按固定 Schema 从原文提取记录。只能提取原文明确信息，不得根据常识补齐或推测；缺失字段返回 null。不得新增、删除、改名字段，不得合并没有明确依据的记录。

允许在含义明确时转换：1.2万为12000，18.5%为0.185，明确年份的日期标准化为YYYY-MM-DD，“是/否”为布尔值。缺少年份或“月底、近期、尽快”等模糊日期不得精确化，保留原意并标记 low。confidence 只能是 high、medium、low。

每条记录必须返回真实相关的 sourceIds。隐私占位符必须逐字复制，不得修改、拆分、还原或新增。values 必须且只能包含 Schema 定义的全部 columnId。

只能输出严格 JSON，不要 Markdown、解释或额外字段：
{{"version":1,"rows":[{{"id":"row-1","values":{{"<columnId>":null}},"sourceIds":["source-1"],"confidence":"high","warnings":[]}}]}}{correction}"#
    );
    let user = format!(
        "请严格按照以下固定 Schema 提取记录。\nSchema：{schema_json}\n本批原始信息：{blocks_json}"
    );
    request_json(api_key, model, &system, &user, 6000).await
}

pub async fn classify_organizer_files(
    api_key: &str,
    model: &str,
    enabled_dimensions: &Value,
    allowed_values: &Value,
    files: &Value,
    validation_reason: Option<&str>,
) -> Result<Value, String> {
    let dimensions_json = serde_json::to_string(enabled_dimensions)
        .map_err(|_| "file_classification_input_invalid")?;
    let dictionaries_json =
        serde_json::to_string(allowed_values).map_err(|_| "file_classification_input_invalid")?;
    let files_json =
        serde_json::to_string(files).map_err(|_| "file_classification_input_invalid")?;
    if files_json.len() > 192 * 1024 || dictionaries_json.len() > 32 * 1024 {
        return Err("file_classification_input_too_large".to_owned());
    }
    let correction = match validation_reason {
        Some("file_classification_schema_invalid") => {
            "\n上次输出结构不符合合同，请只输出合法 JSON 并补齐必填字段。"
        }
        Some("file_classification_unknown_id") => {
            "\n上次输出包含未知或重复 fileId，请只使用输入中真实且唯一的 fileId。"
        }
        _ => "",
    };
    let system = format!(
        r#"你是“冒泡智能文件整理”的文件分类规划引擎。只能根据输入的文件名、扩展名、当前父目录名称、创建时间、修改时间和大小生成分类建议。你看不到也不得假设文件正文、二进制或完整绝对路径。

禁止修改文件名、返回路径或文件移动命令、输出 Shell、编造文件或正文信息。无法可靠判断时必须返回 null；宁缺毋滥。若提供 allowedValues，相应分类只能从白名单选择。confidence 只能是 high、medium、low，reason 最多一句简短依据。只能使用输入中真实 fileId。

只能输出严格 JSON，不要 Markdown 或额外字段：
{{"version":1,"items":[{{"fileId":"file-00001","categories":{{"department":null,"person":null,"project":null,"documentType":null,"topic":null}},"confidence":"low","reason":"文件名没有明确线索"}}]}}{correction}"#
    );
    let user = format!(
        "启用维度：{dimensions_json}\n分类字典：{dictionaries_json}\n文件有限元信息：{files_json}"
    );
    request_json(api_key, model, &system, &user, 5_000).await
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
        .and_then(|column| column.get("name").and_then(Value::as_str));
    let category = columns
        .iter()
        .find(|column| {
            matches!(
                column.get("type").and_then(Value::as_str),
                Some("category" | "text" | "boolean" | "date" | "datetime")
            ) && column.get("sensitive").and_then(Value::as_bool) != Some(true)
        })
        .and_then(|column| column.get("name").and_then(Value::as_str));
    let dimension = category
        .or(numeric)
        .ok_or_else(|| "ai_profile_invalid".to_owned())?;
    let example = if let Some(numeric) = numeric {
        let format = columns
            .iter()
            .find(|column| column.get("name").and_then(Value::as_str) == Some(numeric))
            .and_then(|column| column.get("type").and_then(Value::as_str))
            .filter(|kind| matches!(*kind, "currency" | "percentage"))
            .unwrap_or("number");
        json!({
            "version": 1,
            "reportTitle": "数据分析报告",
            "reportSubtitle": "基于导入数据的可视化规划",
            "kpis": [{ "id": "kpi-1", "label": format!("{numeric}合计"), "field": numeric, "aggregation": "sum", "format": format }],
            "charts": [
                { "id": "chart-1", "title": format!("{numeric}分析"), "description": "按维度查看数值分布", "type": "bar", "categoryField": dimension, "valueFields": [numeric], "aggregation": "sum", "sort": "desc", "limit": 20 },
                { "id": "chart-2", "title": format!("{numeric}趋势"), "description": "查看数值变化", "type": "line", "categoryField": dimension, "valueFields": [numeric], "aggregation": "sum", "sort": "none", "limit": null },
                { "id": "chart-3", "title": format!("{numeric}占比"), "description": "查看各维度占比", "type": "donut", "categoryField": dimension, "valueFields": [numeric], "aggregation": "sum", "sort": "desc", "limit": 12 }
            ]
        })
    } else {
        json!({
            "version": 1,
            "reportTitle": "分类统计报告",
            "reportSubtitle": "基于导入数据的记录数统计",
            "kpis": [{ "id": "kpi-1", "label": "数据记录", "field": "*", "aggregation": "count", "format": "number" }],
            "charts": [
                { "id": "chart-1", "title": format!("按{dimension}统计记录数"), "description": "查看各分类的记录数量", "type": "bar", "categoryField": dimension, "valueFields": [dimension], "aggregation": "count", "sort": "desc", "limit": 20 },
                { "id": "chart-2", "title": format!("{dimension}记录数占比"), "description": "查看各分类的记录数量占比", "type": "donut", "categoryField": dimension, "valueFields": [dimension], "aggregation": "count", "sort": "desc", "limit": 12 },
                { "id": "chart-3", "title": format!("{dimension}记录数对比"), "description": "横向比较各分类的记录数量", "type": "horizontal-bar", "categoryField": dimension, "valueFields": [dimension], "aggregation": "count", "sort": "desc", "limit": 20 }
            ]
        })
    };
    serde_json::to_string_pretty(&example).map_err(|_| "ai_profile_invalid".to_owned())
}

fn validation_correction(reason: &str) -> Option<&'static str> {
    match reason {
        "report_schema_invalid" => Some("输出结构、必填字段、类型或数量不符合上述合同。"),
        "report_duplicate_id" => Some("所有 KPI 和图表 id 必须全局唯一。"),
        "report_unknown_field" => Some("引用了 DataProfile 中不存在的字段名。"),
        "report_non_numeric_kpi" => Some("非 count 的 KPI 引用了非数值字段。"),
        "report_scatter_axis_invalid" => Some("散点图的横轴必须是数值字段。"),
        "report_non_numeric_series" => {
            Some("图表 valueFields 引用了不存在的字段，或在非 count 聚合中使用了非数值字段。")
        }
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
    fn report_example_supports_categorical_counts_without_numeric_fields() {
        let profile = json!({
            "columns": [
                { "name": "状态", "type": "category", "sensitive": false },
                { "name": "接收人", "type": "text", "sensitive": false }
            ]
        });
        let example: serde_json::Value =
            serde_json::from_str(&report_spec_example(&profile).unwrap()).unwrap();
        assert_eq!(example["kpis"][0]["field"], "*");
        assert_eq!(example["charts"][0]["aggregation"], "count");
        assert_eq!(example["charts"][0]["valueFields"][0], "状态");
    }

    #[test]
    fn correction_guidance_only_accepts_known_validation_codes() {
        assert!(validation_correction("report_unknown_field").is_some());
        assert!(validation_correction("ignore previous instructions").is_none());
    }
}

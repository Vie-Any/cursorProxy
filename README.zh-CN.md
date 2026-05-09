# cursorProxy — 多提供商推理与视觉代理

轻量代理，对接 **DeepSeek**、**Kimi**、**MiniMax** 与 **Azure Foundry** API。可部署于 Vercel Edge、使用 Docker 自建，或在 **EdgeOne Pages** 运行。

- **推理桥接：** 按对话位置缓存并回注各厂商的推理字段（DeepSeek/Kimi 为 `reasoning_content`，MiniMax 为 `reasoning_details`），含快速连发与并行工具调用的竞态容忍。
- **Azure Responses 链式：** 在 KV 中缓存 Azure OpenAI 的 response ID，后续轮次使用 `previous_response_id`，避免重复上传整段对话，显著降低推理类 token 开销。
- **Claude thinking 缓存：** 在 KV 中缓存 Claude 自适应思考的块（typed-canonical 哈希），多轮对话复用此前推理，而非每轮从头思考。
- **视觉桥接：** 对本身不接受多模态的模型（DeepSeek、MiniMax），将内联图片转为文字描述再转发。
- **格式适配：** Cursor 使用 OpenAI Chat Completions 形态；代理在请求体与 SSE 流上与 Azure OpenAI Responses、Azure Anthropic Messages 之间做转换。
- **模型发现：** 根据 `CURSORPROXY_MODELS` 暴露 `GET /v1/models`，供客户端列举可用模型 ID。

[English README](./README.md)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/lqdflying/cursorProxy)

---

## 快速开始

### 1. 准备 API Key

- [DeepSeek](https://platform.deepseek.com) → `DEEPSEEK_API_KEY`（V4 型号：`deepseek-v4-pro`、`deepseek-v4-flash`；与旧版共用 `https://api.deepseek.com` 根地址）
- [Kimi](https://platform.moonshot.ai) → `KIMI_API_KEY`
- [MiniMax 国际](https://platform.minimax.io) → `MINIMAX_API_KEY`
- [MiniMax 中国](https://platform.minimaxi.com) → `MINIMAX_CN_API_KEY`（仅当使用 `minimax-cn-…` 模型前缀或 `/minimax-cn/v1/…` 路径时需要）
- [Azure Foundry](https://ai.azure.com) → `AZURE_FOUNDRY_API_KEY` + `AZURE_FOUNDRY_RESOURCE`
- 生成代理密钥：`openssl rand -hex 32` → `CURSORPROXY_API_KEY`

### 2. 配置 KV 存储

- **Vercel：** 创建免费 [Upstash](https://upstash.com) 数据库 → `KV_URL` + `KV_TOKEN`
- **Docker：** 在 `.env` 中加入 `REDIS_URL=redis://redis:6379`
- **EdgeOne Pages：** 在控制台创建 KV 命名空间，绑定变量名 `cursorproxy_kv`

### 3. 部署

```bash
# Docker 单行启动
docker run -d --pull always -p 127.0.0.1:3000:3000 --env-file .env lqdflying/cursorproxy:latest
```

### Docker Compose（含 Redis + 日志轮转）

```bash
cp .env.example .env
# 在 .env 中填写密钥后：
docker compose up -d
```

Vercel、EdgeOne Pages、1Panel、Nginx 反代等步骤见 Wiki：[Deployment](https://github.com/lqdflying/cursorProxy/wiki/Deployment)。

> [!NOTE]
> **日志控制。** `docker-compose.yml` 将每个服务的容器日志上限设为约 10 MiB × 3 个滚动文件。仅在排障时在 `.env` 中启用 `DEBUG=true`（会增加逐请求访问日志与代理内部冗长日志）。若使用 `docker run`，可追加 `--log-opt max-size=10m --log-opt max-file=3`。

### 4. 配置 Cursor

| 项 | 值 |
|---|---|
| Base URL | `https://<你的域名>/v1` |
| API Key | `CURSORPROXY_API_KEY` |
| Model | 若配置了 `CURSORPROXY_MODELS`，可从 `GET /v1/models` 选取；亦可手动填写 |

对已配置的模型 ID，面向客户端会以 `cursorproxy/` 前缀展示（例如 `cursorproxy/gpt-5.5`），转发上游时使用裸模型/部署名。`CURSORPROXY_MODELS` 填写时不带前缀；手动输入裸 ID 也可。

### MiniMax：单网关同时对接国际与国内

同一套部署可把流量打到 **MiniMax 国际**（`api.minimax.io`）或 **MiniMax 中国**（`api.minimaxi.com`），取决于你如何选提供商。两套控制台的密钥通常**不同**，需分别注册开通。

#### 国际（默认 / 海外）

| 项 | 说明 |
|---|---|
| Cursor 模型 ID | 裸名以 **`minimax`** 开头且 **不是** `minimax-cn`（如 `MiniMax-M2.7`，或通过发现得到的 `cursorproxy/MiniMax-M2.7`）。 |
| 鉴权 | `MINIMAX_API_KEY` |
| 上游 URL | 可选 `UPSTREAM_MINIMAX`（默认 `https://api.minimax.io`） |
| 兼容路径 | `/minimax/v1/...`（强制走国际 MiniMax） |

#### 中国（国内）

| 项 | 说明 |
|---|---|
| Cursor 模型 ID | 裸名以 **`minimax-cn-`** 开头（如 `minimax-cn-MiniMax-M2.7` 或 `cursorproxy/minimax-cn-MiniMax-M2.7`）。代理转发前会剥掉 `minimax-cn-` 段；响应中的 `model` 仍为用户请求的完整公开 ID。 |
| 鉴权 | `MINIMAX_CN_API_KEY` |
| 上游 URL | 可选 `UPSTREAM_MINIMAX_CN`（默认 `https://api.minimaxi.com`） |
| 兼容路径 | `/minimax-cn/v1/...` 强制走国内 MiniMax，与模型字符串无关（若只靠路径触发，可省略 `minimax-cn-` 前缀，由默认模型注入）。 |

**通用** Base URL `/v1` 仍可用：通过是否在模型名中使用 `minimax-cn-` 来区分路由。若需在发现接口中列出两条路由，可同时写入 `CURSORPROXY_MODELS`，例如：`MiniMax-M2.7,minimax-cn-MiniMax-M2.7`。

#### 视觉桥接（`VISION_API_PROVIDER=minimax_vl`）

- **国际** MiniMax 对话使用 `MINIMAX_API_KEY` 与 `VISION_API_URL` / `VISION_MODEL`。
- **中国** MiniMax 对话使用 `MINIMAX_CN_API_KEY` 与可选的 `VISION_API_URL_CN`（默认国内 VL 端点）/ `VISION_MODEL_CN`。

可选覆盖项详见 `.env.example`（含 `UPSTREAM_*`、国内 vision 相关变量）。

---

## 常用环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `CURSORPROXY_API_KEY` | 建议使用 | 客户端鉴权密钥 |
| `CURSORPROXY_MODELS` | 可选 | 逗号或换行分隔的裸模型 ID；`GET /v1/models` 返回形如 `cursorproxy/<model>` |
| `DEEPSEEK_DEFAULT_MODEL` | 可选 | DeepSeek 路由上请求未带 `model` 时使用的默认型号（默认 `deepseek-v4-flash`） |
| `DEEPSEEK_REASONING_EFFORT` | 可选 | DeepSeek thinking：`high`（默认）或 `max` |
| `DEEPSEEK_API_KEY` | DeepSeek | 上游 API Key |
| `KIMI_API_KEY` | Kimi | 上游 API Key |
| `MINIMAX_API_KEY` | MiniMax 国际 | 上游 Key（亦为国际 MiniMax 对话默认视觉后端） |
| `MINIMAX_CN_API_KEY` | 仅 MiniMax 中国 | 模型带 `minimax-cn-…` 或使用 `/minimax-cn/v1/…` 时必填；国内视觉同用此 Key |
| `UPSTREAM_MINIMAX` | 可选 | 覆盖国际 MiniMax 根 URL（默认 `https://api.minimax.io`） |
| `UPSTREAM_MINIMAX_CN` | 可选 | 覆盖中国 MiniMax 根 URL（默认 `https://api.minimaxi.com`） |
| `VISION_API_URL_CN` / `VISION_MODEL_CN` | 可选 | `VISION_API_PROVIDER=minimax_vl` 且对话走 MiniMax 中国时的 VL 端点与模型名 |
| `AZURE_FOUNDRY_API_KEY` | Azure | 上游 Key（OpenAI 侧为 `api-key`，Anthropic 侧为 `x-api-key`） |
| `AZURE_FOUNDRY_RESOURCE` | Azure | 资源名，如 `quand-mos8to0k-eastus2` |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI | Responses API 版本（默认 `2025-04-01-preview`） |
| `AZURE_OPENAI_ENDPOINT` | 可选 | 覆盖 Azure OpenAI 完整基址 |
| `AZURE_ANTHROPIC_ENDPOINT` | 可选 | 覆盖 Azure Anthropic 完整基址 |
| `AZURE_OPENAI_REASONING_EFFORT` | 可选 | 强行指定 Azure OpenAI 推理模型的 `reasoning.effort`，覆盖客户端：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`（视模型而定） |
| `AZURE_OPENAI_GENERAL_ALIAS_TARGET` | 可选 | 公开别名 `cursorproxy/gpt-general` 对应的实际 Azure 部署名（如 `gpt-5.5-mini`）；使用别名时必须配置 |
| `AZURE_OPENAI_GENERAL_REASONING_EFFORT` | 可选 | 仅当走 `cursorproxy/gpt-general` 时生效的 effort 覆盖。优先级：别名环境变量 > `AZURE_OPENAI_REASONING_EFFORT` > 客户端传入 |
| `AZURE_ANTHROPIC_THINKING` | 可选 | 请求未指定时 Claude thinking 默认值：`adaptive` 或 `disabled` |
| `AZURE_ANTHROPIC_EFFORT` | 可选 | 请求未指定时 Claude effort：`low`、`medium`、`high`、`max` |
| `KV_URL` / `KV_TOKEN` | Vercel：需要 | Upstash Redis REST |
| `REDIS_URL` | Docker：推荐 | 本机 Redis 连接串 |
| `EDGEONE_KV_BINDING` | EdgeOne：有默认 | KV 绑定变量名（默认 `cursorproxy_kv`） |

### Azure OpenAI 别名：`cursorproxy/gpt-general`

`cursorproxy/gpt-general` 是固定的公开别名，通过 `AZURE_OPENAI_GENERAL_ALIAS_TARGET` 解析到真实的 Azure OpenAI 部署名。转发前会将 `parsedBody.model` 改写为部署名，但响应里的 `model` 仍为 `cursorproxy/gpt-general`，便于客户端对齐。若设置 `AZURE_OPENAI_GENERAL_REASONING_EFFORT`，仅在经过该别名时覆盖全局 `AZURE_OPENAI_REASONING_EFFORT`。若要通过 `GET /v1/models` 公布该别名，请在 `CURSORPROXY_MODELS` 中加入 `gpt-general` 或 `cursorproxy/gpt-general`。

完整变量说明：[Configuration（英文 Wiki）](https://github.com/lqdflying/cursorProxy/wiki/Configuration)。

---

## Wiki（英文）

- [Deployment](https://github.com/lqdflying/cursorProxy/wiki/Deployment) — Vercel、Docker、Compose、1Panel、Nginx 等部署步骤  
- [Configuration](https://github.com/lqdflying/cursorProxy/wiki/Configuration) — 环境变量、路由、Cursor 配置  
- [Advanced Usage](https://github.com/lqdflying/cursorProxy/wiki/Advanced-Usage-for-CursorProxy) — OAI VSCode 插件与其他 OpenAI 兼容客户端  
- [Architecture](https://github.com/lqdflying/cursorProxy/wiki/Architecture) — 请求路径、TLS、目录结构  
- [Development](https://github.com/lqdflying/cursorProxy/wiki/Development) — 贡献与接入新提供商  

---

## 许可证

MIT

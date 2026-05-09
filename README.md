# cursorProxy — Multi-Provider Reasoning & Vision Proxy

A lightweight proxy for **DeepSeek**, **Kimi**, **MiniMax**, and **Azure Foundry** APIs. Deploy on Vercel Edge, self-host via Docker, or run on **EdgeOne Pages**.

简体中文说明见 **[README.zh-CN.md](./README.zh-CN.md)**.

- **Reasoning bridge:** caches and injects provider-specific reasoning (DeepSeek/Kimi `reasoning_content`, MiniMax `reasoning_details`) by conversation position, including race-tolerant handling for fast follow-up and parallel tool calls.
- **Azure Responses chaining:** caches Azure OpenAI response IDs in KV so subsequent turns use `previous_response_id` instead of resending the full conversation, cutting reasoning-token costs significantly.
- **Claude thinking cache:** caches Claude adaptive-thinking blocks in KV (typed-canonical hash) so multi-turn conversations reuse prior reasoning instead of re-thinking from scratch.
- **Vision bridge:** automatically converts inline images to text descriptions for models that don't support vision natively (DeepSeek, MiniMax).
- **Format adapters:** Cursor speaks OpenAI Chat Completions; the proxy translates request bodies and SSE streams to/from Azure OpenAI Responses and Azure Anthropic Messages.
- **Model discovery:** exposes `GET /v1/models` from your configured `CURSORPROXY_MODELS` list so clients can discover available model IDs.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/lqdflying/cursorProxy)

---

## Quick Start

### 1. Get API keys
- [DeepSeek](https://platform.deepseek.com) → `DEEPSEEK_API_KEY` (V4 models: `deepseek-v4-pro`, `deepseek-v4-flash`; same `https://api.deepseek.com` base URL as legacy IDs)
- [Kimi](https://platform.moonshot.ai) → `KIMI_API_KEY`
- [MiniMax International](https://platform.minimax.io) → `MINIMAX_API_KEY`
- [MiniMax China](https://platform.minimaxi.com) → `MINIMAX_CN_API_KEY` (only if you route models with the `minimax-cn-…` prefix or `/minimax-cn/v1/…`)
- [Azure Foundry](https://ai.azure.com) → `AZURE_FOUNDRY_API_KEY` + `AZURE_FOUNDRY_RESOURCE`
- Generate a proxy secret: `openssl rand -hex 32` → `CURSORPROXY_API_KEY`

### 2. Set up KV storage
- **Vercel:** create a free [Upstash](https://upstash.com) database → `KV_URL` + `KV_TOKEN`
- **Docker:** add `REDIS_URL=redis://redis:6379` to your `.env`
- **EdgeOne Pages:** create a KV namespace in the console and bind it with variable name `cursorproxy_kv`

### 3. Deploy

```bash
# Docker one-liner
docker run -d --pull always -p 127.0.0.1:3000:3000 --env-file .env lqdflying/cursorproxy:latest
```

### Docker Compose (with Redis + log rotation)

```bash
cp .env.example .env
# Edit .env with your API keys, then:
docker compose up -d
```

See [Deployment](https://github.com/lqdflying/cursorProxy/wiki/Deployment) for Vercel, EdgeOne Pages, 1Panel, and Nginx reverse proxy.

> [!NOTE]
> **Log control.** `docker-compose.yml` caps container logs at 10 MiB × 3 rotated files per service. Set `DEBUG=true` in `.env` only for troubleshooting — it enables per-request access logs and verbose proxy internals. For `docker run`, add `--log-opt max-size=10m --log-opt max-file=3`.

### 4. Configure Cursor

| Field | Value |
|---|---|
| Base URL | `https://<your-host>/v1` |
| API Key | Your `CURSORPROXY_API_KEY` |
| Model | Discovered from `GET /v1/models` when `CURSORPROXY_MODELS` is set, or manually entered |

The proxy exposes configured model IDs with a `cursorproxy/` prefix (for example, `cursorproxy/gpt-5.5`) while forwarding the bare model/deployment name upstream. Configure `CURSORPROXY_MODELS` without prefixes; manually entered bare IDs are also accepted.

### MiniMax: international vs China on one gateway

The same deployment can send **either** MiniMax International (`api.minimax.io`) **or** MiniMax China (`api.minimaxi.com`), depending on how you select the provider. Keys are normally **different** between regions — register separately on each console.

#### International (default / global)

| Item | Detail |
|---|---|
| Cursor model ID | Bare name begins with **`minimax`** but **not** `minimax-cn` (for example `MiniMax-M2.7`, or `cursorproxy/MiniMax-M2.7` after discovery). |
| Auth | `MINIMAX_API_KEY` |
| Upstream URL | Optional `UPSTREAM_MINIMAX` (default `https://api.minimax.io`) |
| Legacy path | `/minimax/v1/...` (forces international MiniMax) |

#### China (domestic)

| Item | Detail |
|---|---|
| Cursor model ID | Bare name begins with **`minimax-cn-`** (for example `minimax-cn-MiniMax-M2.7` or `cursorproxy/minimax-cn-MiniMax-M2.7`). The proxy strips the `minimax-cn-` segment before forwarding; responses keep the full public id clients asked for. |
| Auth | `MINIMAX_CN_API_KEY` |
| Upstream URL | Optional `UPSTREAM_MINIMAX_CN` (default `https://api.minimaxi.com`) |
| Legacy path | `/minimax-cn/v1/...` forces China MiniMax regardless of model string (model can omit the prefix if you rely on path + default model injection). |

The **generic** base URL `/v1` still applies: pick the route by naming the model with or without `minimax-cn-`. Listing both in `CURSORPROXY_MODELS` exposes both in discovery, for example: `MiniMax-M2.7,minimax-cn-MiniMax-M2.7`.

#### Vision bridge (`VISION_API_PROVIDER=minimax_vl`)

- Requests on **international** MiniMax use `MINIMAX_API_KEY` and `VISION_API_URL` / `VISION_MODEL`.
- Requests on **China** MiniMax use `MINIMAX_CN_API_KEY` and optional `VISION_API_URL_CN` (default China VL endpoint) / `VISION_MODEL_CN`.

See `.env.example` for optional overrides (`UPSTREAM_*`, vision `*_CN` variables).

---

## Essential Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CURSORPROXY_API_KEY` | Recommended | Client auth secret |
| `CURSORPROXY_MODELS` | Optional | Comma- or newline-separated bare model IDs. `GET /v1/models` returns them as `cursorproxy/<model>` |
| `DEEPSEEK_DEFAULT_MODEL` | Optional | Model injected when the request body omits `model` on DeepSeek routes (default `deepseek-v4-flash`) |
| `DEEPSEEK_REASONING_EFFORT` | Optional | DeepSeek thinking effort: `high` (default) or `max` |
| `DEEPSEEK_API_KEY` | For DeepSeek | Upstream API key |
| `KIMI_API_KEY` | For Kimi | Upstream API key |
| `MINIMAX_API_KEY` | For MiniMax International | Upstream API key (also default vision backend for international MiniMax chat) |
| `MINIMAX_CN_API_KEY` | For MiniMax China only | Required when models use prefix `minimax-cn-…` or path `/minimax-cn/v1/…`. China vision uses this key |
| `UPSTREAM_MINIMAX` | Optional | Override MiniMax International base URL (default `https://api.minimax.io`) |
| `UPSTREAM_MINIMAX_CN` | Optional | Override MiniMax China base URL (default `https://api.minimaxi.com`) |
| `VISION_API_URL_CN` / `VISION_MODEL_CN` | Optional | China VL endpoint and model when `VISION_API_PROVIDER=minimax_vl` and chat is routed to MiniMax China |
| `AZURE_FOUNDRY_API_KEY` | For Azure Foundry | Upstream API key (used as `api-key` for OpenAI, `x-api-key` for Anthropic) |
| `AZURE_FOUNDRY_RESOURCE` | For Azure Foundry | Resource name (e.g. `quand-mos8to0k-eastus2`) |
| `AZURE_OPENAI_API_VERSION` | For Azure Foundry | Azure OpenAI Responses API version (default `2025-04-01-preview`) |
| `AZURE_OPENAI_ENDPOINT` | Optional | Override Azure OpenAI base URL (Responses API: `/openai/responses`) |
| `AZURE_ANTHROPIC_ENDPOINT` | Optional | Override Azure Anthropic base URL |
| `AZURE_OPENAI_REASONING_EFFORT` | Optional | Force `reasoning.effort` for Azure OpenAI reasoning models, overriding client values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` (model support varies) |
| `AZURE_OPENAI_GENERAL_ALIAS_TARGET` | Optional | Real Azure OpenAI deployment that the public alias `cursorproxy/gpt-general` resolves to (e.g. `gpt-5.5-mini`). Required when clients use the alias |
| `AZURE_OPENAI_GENERAL_REASONING_EFFORT` | Optional | Alias-only override of `reasoning.effort` when clients route through `cursorproxy/gpt-general`. Precedence: alias env > `AZURE_OPENAI_REASONING_EFFORT` > client value |
| `AZURE_ANTHROPIC_THINKING` | Optional | Default Claude thinking mode when request omits it: `adaptive` or `disabled` |
| `AZURE_ANTHROPIC_EFFORT` | Optional | Default Claude effort when request omits it: `low`, `medium`, `high`, or `max` |
| `KV_URL` / `KV_TOKEN` | Vercel: yes | Upstash Redis REST credentials |
| `REDIS_URL` | Docker: recommended | Local Redis URL |
| `EDGEONE_KV_BINDING` | EdgeOne: no | KV namespace binding variable name (default `cursorproxy_kv`) |

### Azure OpenAI alias: `cursorproxy/gpt-general`

`cursorproxy/gpt-general` is a fixed public alias that routes to a real Azure
OpenAI deployment chosen via `AZURE_OPENAI_GENERAL_ALIAS_TARGET`. The proxy
rewrites `parsedBody.model` to the resolved deployment before forwarding, but
the response `model` field stays as `cursorproxy/gpt-general` so clients see
the alias they asked for. `AZURE_OPENAI_GENERAL_REASONING_EFFORT`, when set,
overrides the global `AZURE_OPENAI_REASONING_EFFORT` for requests that route
through this alias only. To advertise the alias via `GET /v1/models`, also
add `gpt-general` (or `cursorproxy/gpt-general`) to `CURSORPROXY_MODELS`.

Full reference: [Configuration](https://github.com/lqdflying/cursorProxy/wiki/Configuration).

---

## Wiki

- [Deployment](https://github.com/lqdflying/cursorProxy/wiki/Deployment) — Step-by-step: Vercel, Docker, Compose, 1Panel, Nginx
- [Configuration](https://github.com/lqdflying/cursorProxy/wiki/Configuration) — Every env var, routing logic, Cursor setup
- [Advanced Usage](https://github.com/lqdflying/cursorProxy/wiki/Advanced-Usage-for-CursorProxy) — OAI VSCode Plugin and other OpenAI-compatible clients
- [Architecture](https://github.com/lqdflying/cursorProxy/wiki/Architecture) — Request flow, TLS, file structure
- [Development](https://github.com/lqdflying/cursorProxy/wiki/Development) — Contributing, adding providers

---

## License

MIT

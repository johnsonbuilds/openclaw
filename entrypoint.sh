#!/bin/sh
set -e

# 1. 定义路径与运行参数
# OPENCLAW_STATE_DIR 是持久化根目录。
# 如果没有显式覆盖，config 和 workspace 都默认落在这个目录下，避免路径语义分叉。
OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR? "Error: OPENCLAW_STATE_DIR environment variable is required but not set"}
OPENCLAW_CONFIG_PATH=${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}
OPENCLAW_WORKSPACE_DIR=${OPENCLAW_WORKSPACE_DIR:-$OPENCLAW_STATE_DIR/workspace}
CONFIG_FILE="$OPENCLAW_CONFIG_PATH"
CONFIG_DIR=$(dirname "$CONFIG_FILE")
INTERNAL_GATEWAY_PORT=${INTERNAL_GATEWAY_PORT:-18789}
ENTRYPOINT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OPENCLAW_ENTRY=${OPENCLAW_ENTRY:-/openclaw/dist/entry.js}
OPENCLAW_DIST_DIR=$(dirname "$OPENCLAW_ENTRY")

# Always bind the gateway to loopback so it is never directly exposed on the network.
# External access should go through the wrapper (reverse proxy) only.
GATEWAY_BIND=${OPENCLAW_GATEWAY_BIND:-loopback}

OPENCLAW_MAX_OLD_SPACE_MB=${OPENCLAW_MAX_OLD_SPACE_MB:-}

get_mem_limit_mb() {
  if [ -f /sys/fs/cgroup/memory.max ]; then
    limit=$(cat /sys/fs/cgroup/memory.max)
    if [ "$limit" != "max" ]; then
      echo $((limit / 1024 / 1024))
      return
    fi
  fi
  if [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
    if [ "$limit" -gt 0 ] && [ "$limit" -lt 9223372036854771712 ]; then
      echo $((limit / 1024 / 1024))
      return
    fi
  fi
}

if [ -z "$OPENCLAW_MAX_OLD_SPACE_MB" ]; then
  mem_limit_mb=$(get_mem_limit_mb)
  if [ -n "$mem_limit_mb" ]; then
    calc=$((mem_limit_mb * 70 / 100))
    if [ "$calc" -lt 384 ]; then calc=384; fi
    if [ "$calc" -gt 768 ]; then calc=768; fi
    OPENCLAW_MAX_OLD_SPACE_MB=$calc
  else
    OPENCLAW_MAX_OLD_SPACE_MB=1024
  fi
fi

if [ -n "${NODE_OPTIONS:-}" ]; then
  NODE_OPTIONS="${NODE_OPTIONS}"
else
  NODE_OPTIONS=""
fi

export NODE_OPTIONS="--max-old-space-size=${OPENCLAW_MAX_OLD_SPACE_MB} ${NODE_OPTIONS}"
echo "[entrypoint] max-old-space-size=${OPENCLAW_MAX_OLD_SPACE_MB} MB"
echo "[entrypoint] state dir=$OPENCLAW_STATE_DIR"
echo "[entrypoint] config path=$CONFIG_FILE"
echo "[entrypoint] workspace dir=$OPENCLAW_WORKSPACE_DIR"

mkdir -p "$CONFIG_DIR" "$OPENCLAW_WORKSPACE_DIR"

# 2. Config file lifecycle
# By default, do NOT overwrite an existing config on restarts (e.g. when using a persistent volume).
# To force a reset, set OPENCLAW_FORCE_CONFIG=1.
OPENCLAW_FORCE_CONFIG=${OPENCLAW_FORCE_CONFIG:-}
OPENCLAW_CONFIG_EXISTS=0
if [ -f "$CONFIG_FILE" ]; then
  OPENCLAW_CONFIG_EXISTS=1
fi

should_overwrite_config() {
  case "${OPENCLAW_FORCE_CONFIG}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

read_gateway_token_from_config() {
  node -e 'const fs=require("fs"); const p=process.argv[1]; try{const raw=fs.readFileSync(p,"utf8"); const j=JSON.parse(raw); const tok=(j?.gateway?.auth?.token||j?.gateway?.remote?.token||""); if(typeof tok==="string") process.stdout.write(tok.trim());}catch{}' "$CONFIG_FILE" 2>/dev/null || true
}

resolve_gateway_token_source() {
  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    echo "env:OPENCLAW_GATEWAY_TOKEN"
    return
  fi
  if [ -n "${CLAWDBOT_GATEWAY_TOKEN:-}" ]; then
    echo "env:CLAWDBOT_GATEWAY_TOKEN"
    return
  fi
  if [ -n "${GATEWAY_TOKEN:-}" ]; then
    echo "env:GATEWAY_TOKEN"
    return
  fi
  echo "(unset)"
}

validate_openclaw_config_file() {
  node --input-type=module - "$1" "$OPENCLAW_DIST_DIR" <<'EOF'
import path from "node:path";
import { pathToFileURL } from "node:url";

const [configPath, openclawDistDir] = process.argv.slice(2);
process.env.OPENCLAW_CONFIG_PATH = configPath;

try {
  const moduleUrl = pathToFileURL(path.join(openclawDistDir, "plugin-sdk/config-runtime.js")).href;
  const { readConfigFileSnapshotForWrite } = await import(moduleUrl);
  const { snapshot } = await readConfigFileSnapshotForWrite();
  if (snapshot.exists && snapshot.valid) {
    process.exit(0);
  }

  const issues = Array.isArray(snapshot?.issues) ? snapshot.issues : [];
  const details = issues
    .slice(0, 8)
    .map((issue) => {
      const issuePath = typeof issue?.path === "string" && issue.path.length > 0 ? issue.path : "<root>";
      const issueMessage = typeof issue?.message === "string" ? issue.message : "invalid";
      return `${issuePath}: ${issueMessage}`;
    })
    .join(" | ");
  if (details) {
    process.stderr.write(details + "\n");
  }
  process.exit(1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exit(1);
}
EOF
}

ensure_startup_config_is_valid() {
  validation_stage="$1"

  if [ ! -f "$CONFIG_FILE" ]; then
    return 0
  fi

  if validation_error=$(validate_openclaw_config_file "$CONFIG_FILE" 2>&1); then
    return 0
  fi

  backup_file="${CONFIG_FILE}.bak"

  echo "[entrypoint] config recovery: stage=${validation_stage} status=current-invalid path=$CONFIG_FILE" >&2
  if [ -n "$validation_error" ]; then
    echo "[entrypoint] config recovery: current-error=$validation_error" >&2
  fi

  if [ ! -f "$backup_file" ]; then
    echo "[entrypoint] config recovery: stage=${validation_stage} status=backup-missing path=$backup_file" >&2
    return 1
  fi

  if ! backup_error=$(validate_openclaw_config_file "$backup_file" 2>&1); then
    echo "[entrypoint] config recovery: stage=${validation_stage} status=backup-invalid path=$backup_file" >&2
    if [ -n "$backup_error" ]; then
      echo "[entrypoint] config recovery: backup-error=$backup_error" >&2
    fi
    return 1
  fi

  invalid_snapshot="${CONFIG_FILE}.invalid.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$CONFIG_FILE" "$invalid_snapshot" 2>/dev/null || true
  cp "$backup_file" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE" 2>/dev/null || true

  if ! restored_error=$(validate_openclaw_config_file "$CONFIG_FILE" 2>&1); then
    echo "[entrypoint] config recovery: stage=${validation_stage} status=restore-invalid path=$CONFIG_FILE" >&2
    if [ -n "$restored_error" ]; then
      echo "[entrypoint] config recovery: restore-error=$restored_error" >&2
    fi
    return 1
  fi

  echo "[entrypoint] config recovery: stage=${validation_stage} status=restored from=$backup_file to=$CONFIG_FILE" >&2
  if [ -f "$invalid_snapshot" ]; then
    echo "[entrypoint] config recovery: invalid-snapshot=$invalid_snapshot" >&2
  fi
}

require_llm_env() {
  : "${LLM_PROVIDER:?Error: LLM_PROVIDER environment variable is required but not set}"
  : "${LLM_MODEL_ID:?Error: LLM_MODEL_ID environment variable is required but not set}"
  : "${LLM_MODEL_NAME:?Error: LLM_MODEL_NAME environment variable is required but not set}"
  : "${LLM_BASE_URL:?Error: LLM_BASE_URL environment variable is required but not set}"
  : "${LLM_API_KEY:?Error: LLM_API_KEY environment variable is required but not set}"
}

require_llm_update_env() {
  : "${LLM_PROVIDER:?Error: LLM_PROVIDER environment variable is required but not set}"

  case "$(printf '%s' "$LLM_PROVIDER" | tr '[:upper:]' '[:lower:]')" in
    default)
      ;;
    openrouter|openai|anthropic)
      : "${LLM_MODEL_ID:?Error: LLM_MODEL_ID environment variable is required but not set}"
      : "${LLM_API_KEY:?Error: LLM_API_KEY environment variable is required but not set}"
      ;;
    custom)
      : "${LLM_MODEL_ID:?Error: LLM_MODEL_ID environment variable is required but not set}"
      : "${LLM_API_KEY:?Error: LLM_API_KEY environment variable is required but not set}"
      : "${LLM_MODEL_NAME:?Error: LLM_MODEL_NAME environment variable is required but not set}"
      : "${LLM_BASE_URL:?Error: LLM_BASE_URL environment variable is required but not set}"
      ;;
    *)
      ;;
  esac
}

update_llm_config_in_place() {
  require_llm_update_env

  node - "$CONFIG_FILE" <<'EOF'
const fs = require("fs");

const configPath = process.argv[2];
const providerChoice = String(process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
const modelId = process.env.LLM_MODEL_ID;
const modelName = process.env.LLM_MODEL_NAME;
const baseUrl = process.env.LLM_BASE_URL;
const apiKey = process.env.LLM_API_KEY;

const providerMap = {
  openai: {
    envKey: "OPENAI_API_KEY",
    modelProvider: "openai",
  },
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    modelProvider: "anthropic",
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    modelProvider: "openrouter",
  },
  custom: {
    modelProvider: "custom",
  },
};

const selectedProvider = providerMap[providerChoice];
if (providerChoice === "default" || !selectedProvider) {
  process.exit(0);
}

const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

config.env ??= {};
if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) {
  config.env = {};
}

for (const envKey of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]) {
  delete config.env[envKey];
}

config.models ??= {};
if (
  !config.models.providers ||
  typeof config.models.providers !== "object" ||
  Array.isArray(config.models.providers)
) {
  config.models.providers = {};
}

for (const key of Object.keys(config.models.providers)) {
  if (key.trim().toLowerCase() === "custom") {
    delete config.models.providers[key];
  }
}

if (selectedProvider.envKey) {
  config.env[selectedProvider.envKey] = apiKey;
}

if (providerChoice === "custom") {
  config.models.providers.custom = {
    api: "openai-completions",
    baseUrl,
    apiKey,
    models: [
      {
        id: modelId,
        name: modelName,
      },
    ],
  };
}

config.agents ??= {};
config.agents.defaults ??= {};
config.agents.defaults.model ??= {};
config.agents.defaults.model.primary = `${selectedProvider.modelProvider}/${modelId}`;

const tempPath = `${configPath}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
fs.renameSync(tempPath, configPath);
EOF
}

if [ "$OPENCLAW_CONFIG_EXISTS" -eq 1 ] && ! should_overwrite_config; then
  echo "[entrypoint] existing config found at $CONFIG_FILE; updating LLM fields only (set OPENCLAW_FORCE_CONFIG=1 to rebuild config)"
  echo "[entrypoint] config mode: update-llm-only"

  # Best-effort: keep permissions sane, but don't fail startup if chmod is unsupported.
  chmod 600 "$CONFIG_FILE" 2>/dev/null || true
  chmod 700 "$CONFIG_DIR" 2>/dev/null || true

  ensure_startup_config_is_valid "pre-update"

  # Keep gateway token stable across restarts by reusing the existing token from config
  # when no explicit env token is provided.
  if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ] && [ -z "${CLAWDBOT_GATEWAY_TOKEN:-}" ] && [ -z "${GATEWAY_TOKEN:-}" ]; then
    EXISTING_TOKEN=$(read_gateway_token_from_config)
    if [ -n "$EXISTING_TOKEN" ]; then
      export OPENCLAW_GATEWAY_TOKEN="$EXISTING_TOKEN"
      echo "[entrypoint] gateway token source: config(openclaw.json)"
    else
      echo "[entrypoint] gateway token source: (unset; wrapper will generate/persist)"
    fi
  else
    echo "[entrypoint] gateway token source: $(resolve_gateway_token_source)"
  fi

  echo "[entrypoint] syncing LLM config from environment"
  update_llm_config_in_place
  ensure_startup_config_is_valid "post-update"
  case "$(printf '%s' "$LLM_PROVIDER" | tr '[:upper:]' '[:lower:]')" in
    openrouter|openai|anthropic|custom)
    CONFIG_STATUS_MESSAGE="✅ Existing configuration preserved; LLM fields updated at $CONFIG_FILE"
      ;;
    *)
      CONFIG_STATUS_MESSAGE="✅ Existing configuration preserved; LLM fields left unchanged at $CONFIG_FILE"
      ;;
  esac
else
  echo "[entrypoint] config mode: overwrite-defaults"
  # 2. 校验 LLM 环境变量并生成配置
  # 注意：PORT 优先使用 Railway 注入的变量，如果没给则用你跑通的 18789
  APP_PORT=${PORT:-18789}
  require_llm_env

  # 自动生成随机 Gateway Token，如果环境变量没给的话
  GEN_GATEWAY_TOKEN=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
  FINAL_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-${GATEWAY_TOKEN:-$GEN_GATEWAY_TOKEN}}}

  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ] || [ -n "${CLAWDBOT_GATEWAY_TOKEN:-}" ] || [ -n "${GATEWAY_TOKEN:-}" ]; then
    echo "[entrypoint] gateway token source: $(resolve_gateway_token_source)"
  else
    echo "[entrypoint] gateway token source: generated(this-boot)"
  fi

  echo "🛠️ Configuring OpenClaw for SaaS instance..."

  # 3. 动态生成 JSON
  cat <<EOF > "$CONFIG_FILE"
{
  "models": {
    "providers": {
      "$LLM_PROVIDER": {
        "api": "openai-completions",
        "baseUrl": "$LLM_BASE_URL",
        "apiKey": "$LLM_API_KEY",
        "models": [
          {
            "id": "$LLM_MODEL_ID",
            "name": "$LLM_MODEL_NAME"
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "$OPENCLAW_WORKSPACE_DIR",
      "model": {
        "primary": "$LLM_PROVIDER/$LLM_MODEL_ID"
      }
    }
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "pairing",
      "allowFrom": [],
      "botToken": "$TELEGRAM_TOKEN",
      "groupPolicy": "allowlist",
      "streamMode": "partial"
    }
  },
  "gateway": {
    "port": $INTERNAL_GATEWAY_PORT,
    "mode": "local",
    "bind": "$GATEWAY_BIND",
    "auth": {
      "mode": "token",
      "token": "$FINAL_GATEWAY_TOKEN"
    },
    "remote": {
      "token": "$FINAL_GATEWAY_TOKEN"
    },
    "tailscale": {
      "mode": "off",
      "resetOnExit": false
    }
  },
  "skills": {
    "install": {
      "nodeManager": "npm"
    }
  },
  "plugins": {
    "entries": {
      "telegram": {
        "enabled": true
      }
    }
  }
}
EOF

  # 修复 OpenClaw 要求的安全权限
  chmod 600 "$CONFIG_FILE" 
  chmod 700 "$CONFIG_DIR"
  ensure_startup_config_is_valid "post-generate"

  # Keep wrapper/gateway token consistent with the generated config.
  export OPENCLAW_GATEWAY_TOKEN="$FINAL_GATEWAY_TOKEN"
  CONFIG_STATUS_MESSAGE="✅ New configuration generated and secured at $CONFIG_FILE"
fi

# 告知包装层配置路径与 Token
export OPENCLAW_CONFIG_PATH="$CONFIG_FILE"
export OPENCLAW_STATE_DIR
export OPENCLAW_WORKSPACE_DIR
export OPENCLAW_ENTRY

echo "$CONFIG_STATUS_MESSAGE"
echo "🚀 Starting Wrapper Server (server.js)..."

# 必须通过 server.js 启动，才能正确代理流量
# 根据你之前上传的文件，server.js 应该在 src 目录下
exec node src/server.js

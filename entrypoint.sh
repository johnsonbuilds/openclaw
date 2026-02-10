#!/bin/sh
set -e

# 1. 定义路径与运行参数
OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR? "Error: OPENCLAW_STATE_DIR environment variable is required but not set"}
OPENCLAW_WORKSPACE_DIR=${OPENCLAW_WORKSPACE_DIR:-/data/workspace}
CONFIG_DIR="$OPENCLAW_STATE_DIR"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
INTERNAL_GATEWAY_PORT=${INTERNAL_GATEWAY_PORT:-18789}

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

if [ "$OPENCLAW_CONFIG_EXISTS" -eq 1 ] && ! should_overwrite_config; then
  echo "[entrypoint] existing config found at $CONFIG_FILE; keeping it (set OPENCLAW_FORCE_CONFIG=1 to overwrite)"
  echo "[entrypoint] config mode: keep-existing"

  # Best-effort: keep permissions sane, but don't fail startup if chmod is unsupported.
  chmod 600 "$CONFIG_FILE" 2>/dev/null || true
  chmod 700 "$CONFIG_DIR" 2>/dev/null || true

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
else
  echo "[entrypoint] config mode: overwrite-defaults"
  # 2. 设置默认值 (如果环境变量没传，用这些保底)
  # 注意：PORT 优先使用 Railway 注入的变量，如果没给则用你跑通的 18789
  APP_PORT=${PORT:-18789}
  LLM_PROVIDER=${LLM_PROVIDER:-xai}
  LLM_MODEL_ID=${LLM_MODEL_ID:-grok-4-1-fast-reasoning}
  LLM_MODEL_NAME=${LLM_MODEL_NAME:-"Grok 4.1 Fast Reasoning"}
  LLM_BASE_URL=${LLM_BASE_URL:-"https://api.x.ai/v1"}

  # 自动生成随机 Gateway Token，如果环境变量没给的话
  GEN_GATEWAY_TOKEN=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
  FINAL_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-${GATEWAY_TOKEN:-$GEN_GATEWAY_TOKEN}}}

  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ] || [ -n "${CLAWDBOT_GATEWAY_TOKEN:-}" ] || [ -n "${GATEWAY_TOKEN:-}" ]; then
    echo "[entrypoint] gateway token source: $(resolve_gateway_token_source)"
  else
    echo "[entrypoint] gateway token source: generated(this-boot)"
  fi

  echo "🛠️ Configuring OpenClaw for SaaS instance..."

  # 3. 动态生成 JSON (根据你提供的 2026.1.30 格式)
  cat <<EOF > "$CONFIG_FILE"
{
  "meta": {
    "lastTouchedVersion": "2026.1.30",
    "lastTouchedAt": "2026-02-01T15:29:19Z"
  },
  "wizard": {
    "lastRunAt": "2026-02-01T15:29:19Z",
    "lastRunVersion": "2026.1.30",
    "lastRunCommand": "onboard",
    "lastRunMode": "local"
  },
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

  # Keep wrapper/gateway token consistent with the generated config.
  export OPENCLAW_GATEWAY_TOKEN="$FINAL_GATEWAY_TOKEN"
fi

# 告知包装层配置路径与 Token
export OPENCLAW_CONFIG_PATH="$CONFIG_FILE"
export OPENCLAW_STATE_DIR
export OPENCLAW_WORKSPACE_DIR
export OPENCLAW_ENTRY="/openclaw/dist/entry.js"

echo "✅ Configuration generated and secured at $CONFIG_FILE"
echo "🚀 Starting Wrapper Server (server.js)..."

# 必须通过 server.js 启动，才能正确代理流量
# 根据你之前上传的文件，server.js 应该在 src 目录下
exec node src/server.js

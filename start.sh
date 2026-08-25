#!/usr/bin/env bash
set -euo pipefail

AGENT_ROOT="${LINEAR_GROK_AGENT_ROOT:-$HOME/.grok/linear-agent}"
CF_CONFIG="${CLOUDFLARED_CONFIG:-$HOME/.cloudflared/config.yml}"
PUBLIC_URL="https://grokbot.win"
cd "$AGENT_ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "필요 명령이 없습니다: $1" >&2
    exit 1
  fi
}

need node
need npx
need cloudflared
need grok
need gh

if [[ ! -f config.toml ]]; then
  echo "config.toml 이 없습니다. config.toml.example 을 복사해 시크릿을 넣으세요." >&2
  exit 1
fi
if [[ ! -f token.json ]]; then
  echo "token.json 이 없습니다. Linear OAuth 설치를 먼저 끝내세요." >&2
  exit 1
fi
if [[ ! -f "$CF_CONFIG" ]]; then
  echo "Cloudflare named tunnel 설정이 없습니다: $CF_CONFIG" >&2
  exit 1
fi
if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "~/.cloudflared/cert.pem 이 없습니다. cloudflared tunnel login 후 cert.pem 을 넣으세요." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh auth login 이 필요합니다." >&2
  exit 1
fi

bind_port="$(python3 - <<'PY'
from pathlib import Path
text = Path("config.toml").read_text()
for line in text.splitlines():
    if line.startswith("bind_port"):
        print(line.split("=", 1)[1].strip())
        break
else:
    print("8787")
PY
)"

health_ok() {
  local url="$1"
  curl -fsS --max-time 3 "$url/health" 2>/dev/null | grep -q ok
}

pid_on_port() {
  lsof -nP -iTCP:"$bind_port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}'
}

python3 - "$PUBLIC_URL" <<'PY'
from pathlib import Path
import sys
url = sys.argv[1]
path = Path("config.toml")
lines = []
for line in path.read_text().splitlines():
    if line.startswith("public_base_url"):
        lines.append(f'public_base_url = "{url}"')
    else:
        lines.append(line)
path.write_text("\n".join(lines) + "\n")
PY

agent_pid="$(pid_on_port || true)"
if [[ -n "${agent_pid}" ]] && health_ok "http://127.0.0.1:${bind_port}" && health_ok "$PUBLIC_URL"; then
  echo "이미 실행 중입니다."
  echo "  local  http://127.0.0.1:${bind_port}/health"
  echo "  public $PUBLIC_URL/webhook"
  exit 0
fi

if [[ -n "${agent_pid}" ]]; then
  echo "기존 수신기(pid $agent_pid)를 종료합니다."
  kill "$agent_pid" 2>/dev/null || true
  sleep 1
fi

# Replace leftover quick tunnels so only the named tunnel answers.
pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
pkill -f 'cloudflared tunnel run' 2>/dev/null || true
sleep 1

tunnel_log="$AGENT_ROOT/tunnel.log"
: >"$tunnel_log"
cloudflared tunnel --config "$CF_CONFIG" run linear-grok >"$tunnel_log" 2>&1 &
tunnel_pid=$!

for _ in $(seq 1 30); do
  if grep -q 'Registered tunnel connection' "$tunnel_log" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "cloudflared 가 종료되었습니다. $tunnel_log 를 확인하세요." >&2
    tail -20 "$tunnel_log" >&2 || true
    exit 1
  fi
  sleep 0.4
done

cleanup() {
  echo "종료합니다."
  if [[ -n "${agent_child:-}" ]]; then
    kill "$agent_child" 2>/dev/null || true
  fi
  kill "$tunnel_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "터널: $PUBLIC_URL (고정)"
echo "Linear Grok 앱 Webhook: $PUBLIC_URL/webhook"
echo "Redirect URI: $PUBLIC_URL/oauth/callback"
echo

npm start &
agent_child=$!

for _ in $(seq 1 40); do
  if health_ok "http://127.0.0.1:${bind_port}"; then
    break
  fi
  sleep 0.3
done

if ! health_ok "http://127.0.0.1:${bind_port}"; then
  echo "수신기가 뜨지 않았습니다." >&2
  exit 1
fi

echo "수신기 준비: http://127.0.0.1:${bind_port}/health"
if health_ok "$PUBLIC_URL"; then
  echo "공개 URL 준비: $PUBLIC_URL/health"
else
  echo "공개 URL이 아직 안 열릴 수 있습니다. DNS 전파를 잠시 기다린 뒤 $PUBLIC_URL/health 를 확인하세요."
fi
echo "이슈를 Grok에 위임하거나 @Grok 멘션하면 됩니다. Ctrl+C 로 종료."
wait "$agent_child"

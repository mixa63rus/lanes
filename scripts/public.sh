#!/usr/bin/env bash
# Публикует Lanes в интернет через Cloudflare Tunnel: сборка, сервер и туннель.
# Пароль — в .env (создаётся при первом запуске). Ctrl+C останавливает всё.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null || { echo "Нет cloudflared: brew install cloudflared"; exit 1; }

if [ ! -f .env ]; then
  printf 'LANES_USER=lanes\nLANES_PASSWORD=%s\n' "$(openssl rand -base64 18 | tr -d '/+=')" > .env
  echo "Создан .env с новым паролем."
fi
set -a; source .env; set +a
[ -n "${LANES_PASSWORD:-}" ] || { echo "В .env не задан LANES_PASSWORD — без пароля в интернет не выпускаю."; exit 1; }
export PORT="${PORT:-3001}"

npm run build

# caffeinate не даёт маку уснуть, пока работает сервер.
caffeinate -is npm start &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait 2>/dev/null' EXIT

until curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" -u "$LANES_USER:$LANES_PASSWORD"; do sleep 0.5; done

echo
echo "Логин: $LANES_USER   Пароль: $LANES_PASSWORD"
echo "Адрес появится ниже (https://….trycloudflare.com)"
echo
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" 2>&1 | grep --line-buffered -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' 

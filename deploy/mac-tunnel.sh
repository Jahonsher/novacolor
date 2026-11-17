#!/bin/bash
# Mac: Cloudflare quick tunnel to the local server (http://localhost:8080), run by launchd (uz.novacolor.tunnel).
# A quick tunnel gets a NEW random https://*.trycloudflare.com address every time it starts, so on each new
# address this script points vercel.json's /api and /uploads rewrites at it, pushes (Vercel redeploys the old
# link), and updates PUBLIC_URL in .env (links in Telegram messages).
APP="${APP:-/Users/buildfin/Desktop/Jahonsher/NovaColor}"
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"

update() {
  local url="$1"
  cd "$APP" || return
  echo "[mac-tunnel] yangi manzil: $url"
  sed -i '' -E "s#^PUBLIC_URL=.*#PUBLIC_URL=$url#" .env
  launchctl kickstart -k "gui/$(id -u)/uz.novacolor.server" || true
  git pull -q --ff-only origin main || echo "[mac-tunnel] git pull bo'lmadi"
  sed -i '' -E "s#https://[a-z0-9-]+\.trycloudflare\.com#$url#g" vercel.json
  if ! git diff --quiet -- vercel.json; then
    git commit -q -m "Vercel → Mac server: yangi tunnel manzili" -- vercel.json &&
      git push -q origin HEAD:main && echo "[mac-tunnel] vercel.json push qilindi" || echo "[mac-tunnel] push bo'lmadi"
  fi
}

cloudflared tunnel --no-autoupdate --url http://localhost:8080 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) && "${BASH_REMATCH[1]}" != https://api.* ]]; then
    update "${BASH_REMATCH[1]}"
  fi
done

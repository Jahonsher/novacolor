#!/bin/bash
# Mac: Cloudflare quick tunnel to the local server (http://localhost:8080), run by launchd (uz.novacolor.tunnel).
# A quick tunnel gets a NEW random https://*.trycloudflare.com address every time it starts, so on each new
# address this script points vercel.json's /api and /uploads rewrites at it and pushes — Vercel redeploys
# and the usual link keeps working.
#
# macOS does not let launchd scripts touch ~/Desktop, so install this file outside it and use a separate clone:
#   cp deploy/mac-tunnel.sh ~/.local/bin/novacolor-tunnel.sh
#   git clone https://github.com/Jahonsher/novacolor.git ~/.local/share/novacolor-repo
REPO="${REPO:-$HOME/.local/share/novacolor-repo}"
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"

update() {
  local url="$1"
  echo "[mac-tunnel] yangi manzil: $url"
  cd "$REPO" || return
  git pull -q --ff-only origin main || echo "[mac-tunnel] git pull bo'lmadi"
  sed -i '' -E "s#https://[a-z0-9-]+\.trycloudflare\.com#$url#g" vercel.json
  if git diff --quiet -- vercel.json; then echo "[mac-tunnel] vercel.json allaqachon shu manzilda"; return; fi
  git commit -q -m "Vercel → Mac server: yangi tunnel manzili" -- vercel.json &&
    git push -q origin HEAD:main && echo "[mac-tunnel] vercel.json push qilindi" || echo "[mac-tunnel] push bo'lmadi"
}

cloudflared tunnel --no-autoupdate --url http://localhost:8080 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) && "${BASH_REMATCH[1]}" != https://api.* ]]; then
    update "${BASH_REMATCH[1]}"
  fi
done

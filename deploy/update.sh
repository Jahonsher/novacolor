#!/bin/sh
# NovaColor: pull the latest code and rebuild/restart the containers. Data in data/ is kept.
#   ./deploy/update.sh
set -eu
cd "$(dirname "$0")/.."

echo "1/4 Zaxira (backup)..."
./deploy/backup.sh

echo "2/4 Yangi kod (git pull)..."
git pull --ff-only

echo "3/4 Qayta yig'ish va ishga tushirish..."
docker compose up -d --build

echo "4/4 Eski image'larni tozalash..."
docker image prune -f >/dev/null

docker compose ps
echo "Tayyor. Loglar: docker compose logs -f app"

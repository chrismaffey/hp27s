#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

git pull

UID=$(id -u) GID=$(id -g) docker compose up -d --build

#php artisan migrate --force
#!/bin/bash
set -e

echo "[Startup] Registering slash commands..."
node deploy-commands.js

echo "[Startup] Starting bot..."
node index.js

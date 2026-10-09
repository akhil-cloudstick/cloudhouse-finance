#!/usr/bin/env bash
# Run on YOUR computer from the gold-app folder:  ./deploy.sh
set -e
SERVER="USER@SERVER_IP"                                  # <-- edit once
REMOTE="~/apps/cloudhousesupportwild/gold-app"

(cd frontend && npm ci && npm run build)
(cd backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server .)

rsync -az --delete frontend/out/ $SERVER:$REMOTE/deploy/frontend-out/
rsync -az backend/server $SERVER:$REMOTE/deploy/server
ssh $SERVER "cd $REMOTE && chmod +x deploy/server && docker compose up -d --no-build cloudhousewild_backend"
echo "Deployed."

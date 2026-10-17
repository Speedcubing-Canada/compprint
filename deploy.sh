#!/usr/bin/env bash
# Deploy CompPrint to Google App Engine.
#
# Usage: ./deploy.sh

set -euo pipefail

PROJECT="scorecards-v2-prod"

echo "gcloud app deploy app.yaml --project $PROJECT --quiet"
gcloud app deploy app.yaml --project "$PROJECT" --quiet

echo "Deployed to https://${PROJECT}.appspot.com"

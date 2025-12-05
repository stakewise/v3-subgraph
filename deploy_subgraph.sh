#!/usr/bin/env bash

set -euo pipefail

NETWORK="${1:-}"
ENV="${2:-}"

# ---- Validate input ----
if [[ -z "$NETWORK" || -z "$ENV" ]]; then
  echo "Usage: $0 <network: hoodi|gnosis|mainnet> <env: stage|prod>"
  exit 1
fi

if [[ "$NETWORK" != "hoodi" && "$NETWORK" != "gnosis" && "$NETWORK" != "mainnet" ]]; then
  echo "Error: NETWORK must be one of: hoodi, gnosis, mainnet"
  exit 1
fi

if [[ "$ENV" != "stage" && "$ENV" != "prod" ]]; then
  echo "Error: ENV must be either: stage, prod"
  exit 1
fi

# ---- Map network → GRAPH_URL ----
case "$NETWORK" in
  gnosis)
    GRAPH_URL="http://localhost:8020"
    ;;
  hoodi)
    GRAPH_URL="http://localhost:8220"
    ;;
  mainnet)
    GRAPH_URL="http://localhost:8120"
    ;;
esac

# ---- Build ----
echo ">>> Building subgraph: $NETWORK"
npm run "build:$NETWORK"

# ---- Deploy ----
echo ">>> Deploying subgraph: env=$ENV network=$NETWORK"
IPFS_URL="https://ipfs.stakewise.io" \
GRAPH_URL="$GRAPH_URL" \
npm run "deploy-$ENV:$NETWORK"

echo ">>> Done!"

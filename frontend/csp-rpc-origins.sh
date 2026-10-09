#!/bin/sh
# Usage: csp-rpc-origins.sh "<comma-separated RPC URLs>" <nginx.conf>
# Replaces __ANCHOR_RPC_ORIGINS__ in the CSP with the URLs' origins
# (scheme://host[:port]), so the browser verifier may read the chain and nothing else.
set -eu
urls="$1"
conf="$2"
origins=""
old_ifs="$IFS"
IFS=','
for url in $urls; do
  url=$(echo "$url" | tr -d ' ')
  origin=$(echo "$url" | sed -n -E 's#^(https?://[^/]+).*#\1#p')
  [ -n "$origin" ] && origins="$origins $origin"
done
IFS="$old_ifs"
sed -i "s#__ANCHOR_RPC_ORIGINS__#${origins}#" "$conf"
echo "CSP connect-src RPC origins:${origins:- (none)}"

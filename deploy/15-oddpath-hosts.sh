#!/bin/sh
set -eu
for host in "${ODDPATH_APP_HOST:-}" "${ODDPATH_API_HOST:-}" "${ODDPATH_VIEWER_HOST:-}"; do
  if ! printf '%s\n' "$host" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'; then
    echo 'Oddpath ingress requires exact lowercase TLS hostnames.' >&2; exit 1
  fi
done
if [ "$ODDPATH_APP_HOST" = "$ODDPATH_API_HOST" ] || [ "$ODDPATH_APP_HOST" = "$ODDPATH_VIEWER_HOST" ] || [ "$ODDPATH_API_HOST" = "$ODDPATH_VIEWER_HOST" ]; then
  echo 'Oddpath app, API and viewer require distinct origins.' >&2; exit 1
fi
if [ "$ODDPATH_API_HOST" != "$(sed -n '1p' /etc/nginx/oddpath-build-hosts)" ] || [ "$ODDPATH_VIEWER_HOST" != "$(sed -n '2p' /etc/nginx/oddpath-build-hosts)" ]; then
  echo 'Oddpath ingress hostnames differ from the immutable frontend build.' >&2; exit 1
fi

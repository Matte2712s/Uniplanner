#!/bin/sh
set -eu

# Not configured: idle instead of failing, so this container can stay in the
# default compose profile even for deployments that don't use DuckDNS.
if [ -z "${DUCKDNS_SUBDOMAIN:-}" ] || [ -z "${DUCKDNS_TOKEN:-}" ]; then
  echo "duckdns: DUCKDNS_SUBDOMAIN/DUCKDNS_TOKEN not set, idling"
  exec sleep infinity
fi

# Cron jobs don't inherit the container's env, so pass the values through a
# file duck.sh sources instead of relying on that.
cat > /duckdns/env.sh <<EOF
DUCKDNS_SUBDOMAIN="$DUCKDNS_SUBDOMAIN"
DUCKDNS_TOKEN="$DUCKDNS_TOKEN"
DUCKDNS_TXT="${DUCKDNS_TXT:-}"
EOF
chmod 600 /duckdns/env.sh

echo "duckdns: updating $DUCKDNS_SUBDOMAIN.duckdns.org every 5 minutes"

# crond doesn't relay a job's own stdout/stderr to its own by default, so
# redirect to crond's (PID 1's) fds to get every run's output into `docker
# logs` instead of only into duck.log.
echo "*/5 * * * * /duckdns/duck.sh >>/proc/1/fd/1 2>>/proc/1/fd/2" > /etc/crontabs/root

/duckdns/duck.sh
exec crond -f -l 8

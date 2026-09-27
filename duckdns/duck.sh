#!/bin/sh
. /duckdns/env.sh

# IP update and TXT update are sent as two separate requests - DuckDNS's own
# docs show them as distinct examples (the TXT one has no "ip" param at all),
# and combining them into one request was silently dropping the TXT value.
ip_response="$(curl -fsS -G "https://www.duckdns.org/update" \
  --data-urlencode "domains=${DUCKDNS_SUBDOMAIN}" \
  --data-urlencode "token=${DUCKDNS_TOKEN}" \
  --data-urlencode "ip=" 2>&1)"
ip_status=$?
ts="$(date -Is)"

if [ "$ip_status" -ne 0 ]; then
  echo "$ts duckdns: ip update - curl failed (exit $ip_status): $ip_response"
elif [ "$ip_response" = "OK" ]; then
  echo "$ts duckdns: ip update OK ($DUCKDNS_SUBDOMAIN)"
else
  echo "$ts duckdns: ip update FAILED, response=$ip_response - check DUCKDNS_SUBDOMAIN/DUCKDNS_TOKEN"
fi

if [ -n "$DUCKDNS_TXT" ]; then
  txt_response="$(curl -fsS -G "https://www.duckdns.org/update" \
    --data-urlencode "domains=${DUCKDNS_SUBDOMAIN}" \
    --data-urlencode "token=${DUCKDNS_TOKEN}" \
    --data-urlencode "txt=${DUCKDNS_TXT}" \
    --data-urlencode "verbose=true" 2>&1)"
  txt_status=$?
  echo "$txt_response" > /duckdns/duck.log
  if [ "$txt_status" -ne 0 ]; then
    echo "$ts duckdns: txt update - curl failed (exit $txt_status): $txt_response"
  else
    echo "$ts duckdns: txt update response=$txt_response"
  fi
else
  echo "$ip_response" > /duckdns/duck.log
fi

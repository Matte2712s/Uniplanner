FROM alpine:3.20
RUN apk add --no-cache curl
WORKDIR /duckdns
COPY duck.sh /duckdns/duck.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /duckdns/duck.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

#!/usr/bin/env bash
# Generates the private CA and the PostgreSQL server certificate.
#
# The API verifies the server certificate against this CA (sslmode=verify-ca),
# so a stolen connection string alone cannot be pointed at an impostor database.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

CN="${1:-dlt-postgres}"
DAYS="${DLT_CERT_DAYS:-825}"

if [[ -f "$CERTS/server.crt" && -f "$CERTS/ca.crt" && "${DLT_FORCE_CERTS:-0}" != "1" ]]; then
    log "Certificates already present in $CERTS (DLT_FORCE_CERTS=1 to regenerate)"
    exit 0
fi

mkdir -p "$CERTS"; chmod 0700 "$CERTS"
umask 077

log "Generating private CA..."
openssl req -x509 -newkey rsa:4096 -sha256 -days "$DAYS" -nodes \
    -keyout "$CERTS/ca.key" -out "$CERTS/ca.crt" \
    -subj "/O=Dynamic Luggage Tag/CN=DLT Local Development CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

log "Generating server certificate for CN=$CN..."
openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$CERTS/server.key" -out "$CERTS/server.csr" \
    -subj "/O=Dynamic Luggage Tag/CN=$CN" 2>/dev/null

cat > "$CERTS/server.ext" <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1
EXT

openssl x509 -req -in "$CERTS/server.csr" -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key" \
    -CAcreateserial -out "$CERTS/server.crt" -days "$DAYS" -sha256 \
    -extfile "$CERTS/server.ext" 2>/dev/null

rm -f "$CERTS/server.csr" "$CERTS/server.ext" "$CERTS/ca.srl"
chmod 0600 "$CERTS"/*.key
chmod 0644 "$CERTS"/*.crt

log "Wrote CA and server certificate to $CERTS"

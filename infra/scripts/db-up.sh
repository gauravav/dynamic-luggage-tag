#!/usr/bin/env bash
# Builds and starts the hardened PostgreSQL container, then writes the API's
# database settings to api/.env.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

APP_PASSWORD="$(secret db_app_password)"

if [[ "$EXTERNAL_DB" == "1" ]]; then
    [[ -n "$DB_SUPERUSER_PASSWORD" ]] || die "DLT_DB_SUPERUSER_PASSWORD is required when DLT_DB_EXTERNAL=1"
    command -v psql >/dev/null 2>&1 || die "psql is required on the host to provision an external database"

    log "Using the externally managed PostgreSQL on 127.0.0.1:$DB_HOST_PORT (DLT_DB_EXTERNAL=1)"

    if ! psql_super -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
        log "Creating database $DB_NAME..."
        psql_super -d postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_SUPERUSER\"" >/dev/null
    fi

    log "Applying provisioning SQL..."
    psql_super -d "$DB_NAME" \
        -v app_user="$DB_APP_USER" \
        -v app_password="$APP_PASSWORD" \
        -v db_name="$DB_NAME" \
        < "$INFRA/container/initdb/01-schema.sql" >/dev/null

    if [[ "${DLT_ENV:-development}" != "production" ]]; then
        log "Ensuring test database ${DB_NAME}_test..."
        psql_super -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}_test'" | grep -q 1 \
            || psql_super -d postgres -c "CREATE DATABASE \"${DB_NAME}_test\" OWNER \"$DB_APP_USER\"" >/dev/null
        psql_super -d "${DB_NAME}_test" \
            -c "CREATE SCHEMA IF NOT EXISTS dlt AUTHORIZATION \"$DB_APP_USER\"" \
            -c "ALTER ROLE \"$DB_APP_USER\" IN DATABASE \"${DB_NAME}_test\" SET search_path = public" >/dev/null
    fi

    "$INFRA/scripts/write-env.sh"
    log "PostgreSQL ready on 127.0.0.1:$DB_HOST_PORT (external, sslmode=$DB_SSLMODE)"
    exit 0
fi

need_container_cli
"$INFRA/scripts/gen-certs.sh" "$DB_CONTAINER"

SUPER_PASSWORD="$(secret db_superuser_password)"

if ! container image ls --format json 2>/dev/null | grep -q "\"$DB_IMAGE\""; then
    log "Building $DB_IMAGE..."
    container build --tag "$DB_IMAGE" --file "$INFRA/container/Dockerfile.postgres" "$INFRA/container"
fi

if ! container volume ls 2>/dev/null | grep -q "dlt-pgdata"; then
    log "Creating volume dlt-pgdata..."
    # A managed volume, not a bind mount: the data directory needs POSIX
    # ownership that a virtiofs mount from macOS cannot provide.
    container volume create dlt-pgdata -s "${DLT_DB_VOLUME_SIZE:-10G}" >/dev/null
fi

if container_running; then
    log "$DB_CONTAINER is already running"
else
    if container_exists; then
        log "Removing stopped container $DB_CONTAINER..."
        container rm "$DB_CONTAINER" >/dev/null
    fi
    log "Starting $DB_CONTAINER..."
    container run --detach --name "$DB_CONTAINER" \
        --cpus "${DLT_DB_CPUS:-2}" --memory "${DLT_DB_MEMORY:-1G}" \
        --publish "127.0.0.1:$DB_HOST_PORT:5432" \
        --volume dlt-pgdata:/var/lib/postgresql/data \
        `# the volume root is an ext4 mount point with lost+found; the cluster lives below it` \
        --env PGDATA=/var/lib/postgresql/data/pgdata \
        --env POSTGRES_PASSWORD="$SUPER_PASSWORD" \
        --env POSTGRES_DB="$DB_NAME" \
        --env POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --auth-local=trust --data-checksums" \
        "$DB_IMAGE" \
        -c hba_file=/etc/dlt/pg_hba.conf \
        -c ssl=on \
        -c ssl_cert_file=/etc/dlt/tls/server.crt \
        -c ssl_key_file=/etc/dlt/tls/server.key \
        -c ssl_min_protocol_version=TLSv1.2 \
        -c password_encryption=scram-sha-256 \
        -c listen_addresses='*' \
        -c log_connections=on \
        -c log_disconnections=on \
        -c log_statement=ddl \
        -c log_min_duration_statement=1000 \
        >/dev/null
fi

log "Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 60); do
    if container exec "$DB_CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
        break
    fi
    [[ $i -eq 60 ]] && die "PostgreSQL did not become ready. Try: container logs $DB_CONTAINER"
    sleep 1
done

log "Applying provisioning SQL..."
container exec --interactive "$DB_CONTAINER" \
    psql --quiet --no-psqlrc -U postgres -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 \
        -v app_user="$DB_APP_USER" \
        -v app_password="$APP_PASSWORD" \
        -v db_name="$DB_NAME" \
    < "$INFRA/container/initdb/01-schema.sql" >/dev/null

# A throwaway database for the test suite, owned by the same unprivileged role.
# Skipped in production: nothing there should be able to create databases.
if [[ "${DLT_ENV:-development}" != "production" ]]; then
    log "Ensuring test database ${DB_NAME}_test..."
    container exec "$DB_CONTAINER" psql --quiet --no-psqlrc -U postgres -d postgres \
        -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}_test'" | grep -q 1 \
        || container exec "$DB_CONTAINER" psql --quiet --no-psqlrc -U postgres -d postgres \
            -c "CREATE DATABASE ${DB_NAME}_test OWNER $DB_APP_USER" >/dev/null
    container exec "$DB_CONTAINER" psql --quiet --no-psqlrc -U postgres -d "${DB_NAME}_test" \
        -c "CREATE SCHEMA IF NOT EXISTS dlt AUTHORIZATION $DB_APP_USER" \
        -c "ALTER ROLE $DB_APP_USER IN DATABASE ${DB_NAME}_test SET search_path = public" >/dev/null
fi

"$INFRA/scripts/write-env.sh"

log "PostgreSQL ready on 127.0.0.1:$DB_HOST_PORT (TLS required, SCRAM-SHA-256)"

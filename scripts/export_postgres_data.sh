#!/usr/bin/env bash
# Export legacy Postgres tables to CSV before clearing the Docker volume.
# For use with this git commit: #21db89e
#
# Usage (from the monetise project directory on prod):
#   ./export_postgres_data.sh
#
# Override defaults if needed:
#   EXPORT_TABLES="sites visitors SiteVisitor" ./export_postgres_data.sh
#   DOCKER_CONTAINER=monetise-db-1 ./export_postgres_data.sh
#   COMPOSE_CMD="docker-compose" ./export_postgres_data.sh
#
# Output:
#   data/postgres_export_YYYYMMDD_HHMMSS/
#     sites.csv, visitors.csv, SiteVisitor.csv, manifest.txt
#   data/postgres_export_YYYYMMDD_HHMMSS.tar.gz

set -euo pipefail

COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"
DB_SERVICE="${DB_SERVICE:-db}"
PGUSER="${PGUSER:-monetise}"
PGPASSWORD="${PGPASSWORD:-monetise_password}"
PGDATABASE="${PGDATABASE:-monetise}"
EXPORT_ROOT="${EXPORT_ROOT:-data}"

# Sequelize: sites (explicit), Visitors, SiteVisitors — prod may use visitors / SiteVisitor.
if [[ -z "${EXPORT_TABLES:-}" ]]; then
  EXPORT_TABLES="sites visitors SiteVisitor"
fi

read -r -a TABLES <<< "$EXPORT_TABLES"

timestamp="$(date +%Y%m%d_%H%M%S)"
export_dir="${EXPORT_ROOT}/postgres_export_${timestamp}"
archive="${EXPORT_ROOT}/postgres_export_${timestamp}.tar.gz"

mkdir -p "$export_dir"

psql_exec() {
  if [[ -n "${DOCKER_CONTAINER:-}" ]]; then
    docker exec -i -e PGPASSWORD="$PGPASSWORD" "$DOCKER_CONTAINER" \
      psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 "$@"
  else
    $COMPOSE_CMD exec -T -e PGPASSWORD="$PGPASSWORD" "$DB_SERVICE" \
      psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 "$@"
  fi
}

quote_table() {
  # PostgreSQL needs double quotes for mixed-case / reserved identifiers.
  printf '"%s"' "${1//\"/\"\"}"
}

table_to_filename() {
  # SiteVisitor -> SiteVisitor.csv, sites -> sites.csv
  printf '%s.csv' "$1"
}

echo "Export directory: $export_dir"
echo "Tables: ${TABLES[*]}"
echo

{
  echo "postgres export ${timestamp}"
  echo "database: ${PGDATABASE}"
  echo "user: ${PGUSER}"
  echo
} > "${export_dir}/manifest.txt"

for table in "${TABLES[@]}"; do
  outfile="${export_dir}/$(table_to_filename "$table")"
  quoted="$(quote_table "$table")"

  echo -n "Exporting ${table}... "

  row_count="$(psql_exec -t -A -c "SELECT COUNT(*) FROM ${quoted};")"
  psql_exec -c "COPY (SELECT * FROM ${quoted}) TO STDOUT WITH (FORMAT CSV, HEADER true)" > "$outfile"

  exported_lines="$(wc -l < "$outfile" | tr -d ' ')"
  data_rows=$((exported_lines > 0 ? exported_lines - 1 : 0))

  {
    echo "${table}"
    echo "  rows (count query): ${row_count}"
    echo "  rows (csv data):    ${data_rows}"
    echo "  file:               $(basename "$outfile")"
    echo
  } >> "${export_dir}/manifest.txt"

  echo "${row_count} rows -> $(basename "$outfile")"
done

echo
echo "Creating archive: ${archive}"
tar -czf "$archive" -C "$EXPORT_ROOT" "$(basename "$export_dir")"

echo
echo "Done."
echo "  Directory: ${export_dir}/"
echo "  Archive:   ${archive}"
echo
cat "${export_dir}/manifest.txt"

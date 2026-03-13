#!/bin/bash
#
# seed-activities-from-bus.sh
# One-time migration to backfill MC activities from OpenClaw event bus
#
# Usage: ./scripts/seed-activities-from-bus.sh [--dry-run]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUS_FILE="${HOME}/.openclaw/events/bus.jsonl"
DB_FILE="${PROJECT_DIR}/.data/mission-control.db"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE ==="
fi

# Check prerequisites
if [[ ! -f "$BUS_FILE" ]]; then
    echo "ERROR: Bus file not found: $BUS_FILE" >&2
    exit 1
fi

if [[ ! -f "$DB_FILE" ]]; then
    echo "ERROR: Database not found: $DB_FILE" >&2
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "ERROR: jq is required but not installed" >&2
    exit 1
fi

echo "Bus file: $BUS_FILE ($(wc -l < "$BUS_FILE" | tr -d ' ') lines)"
echo "Database: $DB_FILE"
echo ""

# Get count before
COUNT_BEFORE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM activities;")
echo "Activities before: $COUNT_BEFORE"

# Create temp file for SQL statements
TEMP_SQL=$(mktemp)
trap "rm -f $TEMP_SQL" EXIT

# Start transaction
echo "BEGIN TRANSACTION;" > "$TEMP_SQL"

# Process each line of bus.jsonl
PROCESSED=0
SKIPPED=0
PARSE_ERRORS=0

while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines
    [[ -z "$line" ]] && continue

    # Try to parse JSON
    if ! parsed=$(echo "$line" | jq -c '.' 2>/dev/null); then
        ((PARSE_ERRORS++))
        continue
    fi

    # Extract fields
    ts=$(echo "$parsed" | jq -r '.ts // empty')
    agent=$(echo "$parsed" | jq -r '.agent // "system"')
    type=$(echo "$parsed" | jq -r '.type // empty')
    message=$(echo "$parsed" | jq -r '.message // empty')
    data=$(echo "$parsed" | jq -c '.data // null')

    # Skip if missing required fields
    if [[ -z "$ts" || -z "$type" ]]; then
        ((SKIPPED++))
        continue
    fi

    # Convert ISO timestamp to Unix epoch
    # Handle both formats: 2026-02-28T06:45:24Z and 2026-02-28T06:45:24.123Z
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: use date with -j -f
        # Remove milliseconds if present
        ts_clean=$(echo "$ts" | sed 's/\.[0-9]*Z$/Z/')
        created_at=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts_clean" "+%s" 2>/dev/null || echo "")
    else
        # Linux: use date -d
        created_at=$(date -d "$ts" "+%s" 2>/dev/null || echo "")
    fi

    if [[ -z "$created_at" ]]; then
        ((SKIPPED++))
        continue
    fi

    # Escape single quotes for SQL
    type_escaped=$(echo "$type" | sed "s/'/''/g")
    agent_escaped=$(echo "$agent" | sed "s/'/''/g")
    message_escaped=$(echo "$message" | sed "s/'/''/g")
    data_escaped=$(echo "$data" | sed "s/'/''/g")

    # entity_id is 0 since we don't have agent IDs in bus events
    # This INSERT OR IGNORE will skip if the exact combination exists
    cat >> "$TEMP_SQL" <<EOF
INSERT OR IGNORE INTO activities (type, entity_type, entity_id, actor, description, data, created_at, workspace_id)
SELECT '${type_escaped}', 'agent', 0, '${agent_escaped}', '${message_escaped}', '${data_escaped}', ${created_at}, 1
WHERE NOT EXISTS (
    SELECT 1 FROM activities
    WHERE type = '${type_escaped}'
    AND actor = '${agent_escaped}'
    AND description = '${message_escaped}'
    AND created_at = ${created_at}
    AND workspace_id = 1
);
EOF

    ((PROCESSED++))
done < "$BUS_FILE"

# Commit transaction
echo "COMMIT;" >> "$TEMP_SQL"

echo ""
echo "Processed: $PROCESSED events"
echo "Skipped (missing fields): $SKIPPED"
echo "Parse errors: $PARSE_ERRORS"
echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo "DRY RUN: Would execute $(wc -l < "$TEMP_SQL" | tr -d ' ') SQL statements"
    echo "First 20 statements:"
    head -25 "$TEMP_SQL"
else
    echo "Executing SQL..."
    sqlite3 "$DB_FILE" < "$TEMP_SQL"

    COUNT_AFTER=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM activities;")
    INSERTED=$((COUNT_AFTER - COUNT_BEFORE))

    echo ""
    echo "=== RESULTS ==="
    echo "Activities before: $COUNT_BEFORE"
    echo "Activities after:  $COUNT_AFTER"
    echo "Inserted:          $INSERTED"
    echo "Duplicates skipped: $((PROCESSED - INSERTED))"
    echo ""
    echo "Type distribution (top 10):"
    sqlite3 "$DB_FILE" "SELECT type, COUNT(*) as cnt FROM activities GROUP BY type ORDER BY cnt DESC LIMIT 10;"
fi

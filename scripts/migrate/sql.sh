#!/usr/bin/env bash
# Run a SQL file against the Gather project via the Supabase Management API.
# Usage: scripts/migrate/sql.sh <file.sql>   (requires SUPABASE_ACCESS_TOKEN in env)
set -euo pipefail
f="$1"
grep -Eiq 'drop[[:space:]]+schema' "$f" && { echo "refusing: drop schema" >&2; exit 1; }
body=$(python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$f")
curl -sS -X POST "https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary "$body"
echo

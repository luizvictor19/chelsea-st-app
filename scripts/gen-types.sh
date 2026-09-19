#!/usr/bin/env bash
#
# Regenerate src/lib/supabase/types.ts, the whole procedure in one call.
#
# It exists because the generator writes the whole file. `supabase gen types
# ... > src/lib/supabase/types.ts` replaces every byte, so the comment at the
# top of that file — which is the only place saying where the types come from
# and why not from the deployed project — is destroyed by every regeneration
# that does not put it back by hand. It has been put back by hand every time
# so far, and on 2026-09-19 it was not. A step that is remembered is a step
# that is eventually forgotten.
#
# So the header lives here, in a heredoc, and is prepended by the same run
# that generates the body. scripts/types-header.test.ts holds the two copies
# to being identical, because a header edited in the file and not here would
# be reverted by the next run, silently, which is the failure this script was
# written to end.
#
# The schema comes from the migrations and not from the deployed project: the
# deployed project keeps pgcrypto in the extensions schema, and generating
# from there drops its functions out of the file without saying so. The
# throwaway Postgres is built by scripts/verify-rls.sql, which is also what
# proves the migrations apply, so the types and the row level security check
# are made from exactly the same schema.
#
# Needs docker and the supabase CLI on the host. psql is not needed: it runs
# inside the container, which is also why the migrations are copied in rather
# than reached over a socket.
#
# Usage: scripts/gen-types.sh

set -euo pipefail

cd -- "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.."

readonly OUT="src/lib/supabase/types.ts"
readonly IMAGE="postgres:17"
readonly CONTAINER="chelsea-gen-types-$$"

# Kept next to nothing else: this is the text that would otherwise be lost.
# Edit it here, never in the generated file.
types_header() {
  cat <<'TYPES_HEADER'
/**
 * Generated from the migrations in supabase/migrations, not from the deployed
 * project, so the types describe the schema this repository defines. Source
 * matters: the deployed project keeps pgcrypto in the extensions schema, and
 * generating from there silently drops its functions out of this file.
 *
 * Regenerate with scripts/gen-types.sh, which is the whole procedure in one
 * call. Never run the generator on its own: it writes the whole file, so the
 * comment you are reading is destroyed by any generation that does not put it
 * back, and putting it back is a step someone eventually forgets.
 *
 * Hand edits are lost on the next run.
 */
TYPES_HEADER
}

die() {
  echo "gen-types: $*" >&2
  exit 1
}

command -v docker >/dev/null || die "docker is not on PATH"
command -v supabase >/dev/null || die "the supabase CLI is not on PATH"
[ -f scripts/verify-rls.sql ] || die "run me from anywhere, but the repo must be intact"

# Before anything is started, so a failure here leaves nothing behind.
work="$(mktemp -d)"

# Torn down however this ends: a success, a failed migration, a Ctrl-C. A
# container left running holds the port and the next run picks a different
# one, so the leak would be quiet until the machine ran out of them.
cleanup() {
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT

echo "gen-types: starting $IMAGE"
# Docker picks the host port. A fixed one would collide with whatever else is
# listening, and this script is not worth an argument about which port.
docker run --detach --name "$CONTAINER" \
  --env POSTGRES_PASSWORD=postgres \
  --publish 127.0.0.1::5432 \
  "$IMAGE" >/dev/null

ready=""
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready --quiet 2>/dev/null; then
    ready="yes"
    break
  fi
  sleep 1
done
[ -n "$ready" ] || die "Postgres did not come up in 60 seconds"

echo "gen-types: applying the migrations through scripts/verify-rls.sql"
docker exec "$CONTAINER" mkdir -p /work/supabase /work/scripts
docker cp supabase/migrations "$CONTAINER:/work/supabase/migrations"
docker cp scripts/verify-rls.sql "$CONTAINER:/work/scripts/verify-rls.sql"
docker exec --workdir /work --user postgres "$CONTAINER" \
  psql --quiet -v ON_ERROR_STOP=1 -f scripts/verify-rls.sql

port="$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
[ -n "$port" ] || die "could not read the published port"

echo "gen-types: generating"
supabase gen types typescript \
  --db-url "postgresql://postgres:postgres@127.0.0.1:${port}/postgres" \
  --schema public >"$work/body.ts"

# Checked before anything is overwritten. Written straight into $OUT, a
# generator that failed halfway would leave the file truncated, and a
# truncated types.ts fails the build in a way that looks like a code problem.
[ -s "$work/body.ts" ] || die "the generator produced nothing"
grep -q "export type Database" "$work/body.ts" ||
  die "the generator produced something that is not the types"

{
  types_header
  echo
  cat "$work/body.ts"
} >"$work/types.ts"

mv -- "$work/types.ts" "$OUT"
npx prettier --write "$OUT" >/dev/null

echo "gen-types: wrote $OUT"

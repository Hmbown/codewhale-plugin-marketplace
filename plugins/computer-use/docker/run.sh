#!/bin/sh
# Build the Linux box and run something in it, then bring the receipts back.
#
#   docker/run.sh                       # npm test
#   docker/run.sh parity                # npm run parity -- --isolated
#   docker/run.sh smoke                 # npm run smoke
#   docker/run.sh shell                 # interactive shell on the X session
#   docker/run.sh -- <any command>      # anything else, inside the session
#
# Receipts written under /app/receipts land in ./receipts/linux-docker/<run>/
# on the host. The source is copied into the image, not mounted, so a run
# always reflects a build — edit, re-run, the layer cache keeps it quick.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE="${CU_IMAGE:-codewhale-cu-linux}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
CONTAINER="cu-linux-$RUN_ID"
OUT="$ROOT/receipts/linux-docker/$RUN_ID"

mode="${1:-test}"
[ $# -gt 0 ] && shift || true
case "$mode" in
  test)   set -- npm test ;;
  parity) set -- npm run parity -- --isolated "$@" ;;
  smoke)  set -- npm run smoke "$@" ;;
  shell)  set -- /bin/bash ;;
  --)     ;;
  *)      echo "usage: docker/run.sh [test|parity|smoke|shell|-- <command>]" >&2; exit 2 ;;
esac

echo "==> building $IMAGE"
docker build -t "$IMAGE" -f "$ROOT/docker/Dockerfile" "$ROOT"

# --ipc=host keeps Chromium off the 64MB default /dev/shm; --init reaps the
# Xvfb, openbox and fixture processes the run leaves behind.
tty_flags=""
[ -t 0 ] && tty_flags="-it"

echo "==> running: $*"
status=0
# shellcheck disable=SC2086
docker run --name "$CONTAINER" $tty_flags --init --ipc=host \
  -e CU_HOST_GEOMETRY \
  "$IMAGE" "$@" || status=$?

mkdir -p "$OUT"
docker cp "$CONTAINER:/app/receipts/." "$OUT" 2>/dev/null || echo "(no receipts written)"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> receipts: $OUT"
exit "$status"

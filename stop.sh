#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$ROOT_DIR/.tools/dev-session.pid"

if [[ ! -f "$STATE_FILE" ]]; then
    printf 'No managed local session is running.\n'
    exit 0
fi

mapfile -t state < "$STATE_FILE"
if ((${#state[@]} != 3)) || [[ "${state[2]}" != "$ROOT_DIR" ]] || [[ ! "${state[0]}" =~ ^[0-9]+$ ]]; then
    printf 'Session record is invalid or belongs to another checkout. No processes were stopped.\n' >&2
    exit 1
fi
launcher_pid="${state[0]}"
expected_start="${state[1]}"
if [[ ! -r "/proc/$launcher_pid/stat" ]]; then
    rm -f "$STATE_FILE"
    printf 'Removed a stale session record; no managed process was running.\n'
    exit 0
fi

actual_start="$(python3 - "$launcher_pid" <<'PY'
import sys

stat = open(f"/proc/{sys.argv[1]}/stat", encoding="utf-8").read()
print(stat.rsplit(")", 1)[1].split()[19])
PY
)"
process_cwd="$(readlink "/proc/$launcher_pid/cwd" 2>/dev/null || true)"
process_args="$(tr '\0' ' ' < "/proc/$launcher_pid/cmdline" 2>/dev/null || true)"
if [[ "$actual_start" != "$expected_start" ]] || [[ "$process_cwd" != "$ROOT_DIR" ]] || [[ "$process_args" != *"start.sh"* ]]; then
    printf 'Session PID no longer identifies this checkout launcher. No processes were stopped; inspect %s.\n' "$STATE_FILE" >&2
    exit 1
fi

kill -TERM "$launcher_pid"
for _ in {1..50}; do
    if [[ ! -r "/proc/$launcher_pid/stat" ]]; then
        printf 'SproutSync dashboard and API stopped.\n'
        exit 0
    fi
    sleep 0.1
done
printf 'Launcher did not stop in time. Press Ctrl+C in its terminal and inspect the .tools logs.\n' >&2
exit 1

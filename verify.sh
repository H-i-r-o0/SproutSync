#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
online=0
if (($# > 1)); then
    printf 'Usage: ./verify.sh [--online]\n' >&2
    exit 2
fi
if [[ "${1:-}" == "--online" ]]; then
    online=1
elif [[ -n "${1:-}" ]]; then
    printf 'Usage: ./verify.sh [--online]\n' >&2
    exit 2
fi

ready=1
printf 'SproutSync dependency verification (read-only)\n'

if command -v node >/dev/null 2>&1; then
    node_version="$(node --version)"
    if node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
        printf '[OK] Node.js %s (required: 22.12+)\n' "$node_version"
    else
        printf '[WRONG VERSION] Node.js %s - install 22.12+\n' "$node_version"
        ready=0
    fi
    if command -v npm >/dev/null 2>&1; then
        printf '[OK] npm %s\n' "$(npm --version)"
    else
        printf '[MISSING] npm - install npm with Node.js.\n'
        ready=0
    fi
    node_report="$(node scripts/check-node-dependencies.mjs 2>/dev/null || true)"
    if [[ -n "$node_report" ]]; then
        node - "$node_report" <<'NODE'
const report = JSON.parse(process.argv[2]);
console.log('\nJavaScript libraries');
for (const item of report.packages) {
  const version = item.installed ?? 'not installed';
  console.log(`[${item.status}] ${item.name} - ${version} (required: ${item.expected})`);
}
for (const problem of report.problems) console.log(`[ACTION] ${problem}`);
NODE
        if ! node -e 'process.exit(JSON.parse(process.argv[1]).ready ? 0 : 1)' "$node_report"; then
            ready=0
        fi
    else
        printf '[BROKEN] Could not inspect JavaScript dependencies or package-lock.json.\n'
        ready=0
    fi
else
    printf '[MISSING] Node.js 22.12+ - install Node.js and npm.\n'
    ready=0
fi

if command -v python3 >/dev/null 2>&1; then
    python_version="$(python3 --version 2>&1)"
    if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
        printf '[OK] %s (required: Python 3.12+)\n' "$python_version"
    else
        printf '[WRONG VERSION] %s - install Python 3.12+\n' "$python_version"
        ready=0
    fi
else
    printf '[MISSING] Python 3.12+ - install Python.\n'
    ready=0
fi

python="$ROOT_DIR/backend/api/.venv/bin/python"
if [[ -x "$python" ]]; then
    python_report="$("$python" -B scripts/check_python_dependencies.py 2>/dev/null || true)"
    if [[ -n "$python_report" ]]; then
        "$python" - "$python_report" <<'PY'
import json
import sys

report = json.loads(sys.argv[1])
print("\nPython libraries")
for item in report["packages"]:
    version = item["installed"] or "not installed"
    print(f'[{item["status"]}] {item["name"]} - {version} (required: {item["expected"]})')
for problem in report["problems"]:
    print(f"[ACTION] {problem}")
PY
        if ! "$python" -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1])["ready"] else 1)' "$python_report"; then
            ready=0
        fi
    else
        printf '[BROKEN] Could not inspect Python dependencies.\n'
        ready=0
    fi
else
    printf '[MISSING] Python virtual environment/packages - ./start.sh creates and installs them.\n'
    ready=0
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
    if command -v node >/dev/null 2>&1 && [[ -n "${node_report:-}" ]] && node -e 'process.exit(JSON.parse(process.argv[1]).ready ? 0 : 1)' "$node_report"; then
        if ! node scripts/check-setup.mjs; then
            ready=0
        elif ((online)) && [[ -x "$python" ]]; then
            if ! "$python" -m app.check_setup; then
                ready=0
            fi
        fi
    else
        printf '[INFO] .env exists; value validation needs the JavaScript dependencies.\n'
    fi
else
    printf '[MISSING] .env - ./start.sh creates a template; fill the five project values before starting.\n'
    ready=0
fi

if ((ready)); then
    printf 'READY: required dependencies and local configuration are present.\n'
    exit 0
fi
printf 'ACTION NEEDED: resolve the items above, then run ./start.sh to install missing project packages.\n'
exit 1

#!/usr/bin/env bash
#
# claudinha-hook-relay.sh — Claude Code hook relay for Claudio
#
# Called by Claude Code's hook system with the event name as the first argument.
# Reads the hook JSON payload from stdin, injects routing fields, and writes
# the payload to the Claudio Unix socket so HookListener can route it to the
# correct pane.
#
# Environment variables (set by PtyPool at pane spawn time):
#   CLAUDINHA_PANE_ID      — pane UUID for routing
#   CLAUDINHA_SOCKET_PATH  — path to the Claudio Unix domain socket
#
# Usage (configured in .claude/settings.json hooks):
#   claudinha-hook-relay.sh SessionStart
#   claudinha-hook-relay.sh PreToolUse
#   claudinha-hook-relay.sh PostToolUse
#   claudinha-hook-relay.sh Notification
#   claudinha-hook-relay.sh Stop
#   claudinha-hook-relay.sh StopFailure
#
# Exit behavior: always exits 0. Claude Code's hook timeout is ~5s;
# we set a 2s socket timeout to stay well under that.

HOOK_EVENT="${1:-}"
INPUT="$(cat)"

export HOOK_EVENT INPUT CLAUDINHA_PANE_ID CLAUDINHA_SOCKET_PATH

python3 - <<'PYEOF'
import json, socket, os, sys

hook_event   = os.environ.get('HOOK_EVENT', '')
pane_id      = os.environ.get('CLAUDINHA_PANE_ID', '')
socket_path  = os.environ.get('CLAUDINHA_SOCKET_PATH', '')
raw_input    = os.environ.get('INPUT', '')

try:
    payload = json.loads(raw_input) if raw_input.strip() else {}

    # Inject routing fields if not already present
    if 'hookEventName' not in payload and hook_event:
        payload['hookEventName'] = hook_event
    if 'paneId' not in payload and pane_id:
        payload['paneId'] = pane_id

    if not socket_path:
        sys.exit(0)

    msg = (json.dumps(payload) + '\n').encode('utf-8')

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(2.0)
        s.connect(socket_path)
        s.sendall(msg)

except Exception:
    pass  # Always exit cleanly — never block or fail the hook chain

PYEOF

exit 0

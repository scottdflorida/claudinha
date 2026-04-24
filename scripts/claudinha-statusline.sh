#!/usr/bin/env bash
#
# claudinha-statusline.sh — Claude Code statusline hook for Claudio
#
# Called by Claude Code whenever it updates the statusline JSON. Reads the
# full JSON payload from stdin and writes it to a temp file so MetricsCollector
# can pick it up and forward metrics to the renderer.
#
# Environment variables:
#   CLAUDINHA_PANE_ID  — pane UUID used to name the temp file
#
# Output: prints a minimal empty JSON object to stdout (required by Claude Code —
# the hook output is used as the statusline display text; empty = no display).
#
# Exit behavior: always exits 0.

PANE_ID="${CLAUDINHA_PANE_ID:-}"

if [ -n "$PANE_ID" ]; then
    # Write stdin atomically via a temp file then rename
    TMPFILE="/tmp/claudinha-statusline-${PANE_ID}.json.tmp"
    DESTFILE="/tmp/claudinha-statusline-${PANE_ID}.json"
    cat > "$TMPFILE" 2>/dev/null && mv "$TMPFILE" "$DESTFILE" 2>/dev/null || true
fi

# Required: print minimal text to stdout so Claude Code has a statusline value
echo ""

exit 0

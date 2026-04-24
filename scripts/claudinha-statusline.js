#!/usr/bin/env node
/**
 * claudinha-statusline.js — Windows-compatible Claude Code statusline hook for Claudio.
 *
 * Called by Claude Code whenever it updates the statusline JSON. Reads the
 * full JSON payload from stdin and writes it atomically to a temp file so
 * MetricsCollector can pick it up and forward metrics to the renderer.
 *
 * Environment variables:
 *   CLAUDINHA_PANE_ID  — pane UUID used to name the temp file
 *
 * Output: prints an empty line to stdout (required by Claude Code —
 * the hook output is used as the statusline display text; empty = no display).
 *
 * Exit behavior: always exits 0.
 *
 * Temp directory: uses os.tmpdir() on Windows, /tmp on macOS/Linux (matching
 * the shell script counterpart and the Node.js readers in MetricsCollector).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const paneId = process.env.CLAUDINHA_PANE_ID || ''
const tmpDir = process.platform === 'win32' ? os.tmpdir() : '/tmp'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  if (paneId) {
    const tmpFile = path.join(tmpDir, `claudinha-statusline-${paneId}.json.tmp`)
    const destFile = path.join(tmpDir, `claudinha-statusline-${paneId}.json`)
    try {
      fs.writeFileSync(tmpFile, input, 'utf8')
      fs.renameSync(tmpFile, destFile)
    } catch {
      // Ignore write errors — MetricsCollector will use PTY fallback
    }
  }

  // Required: print empty line to stdout so Claude Code has a statusline value
  process.stdout.write('\n')
  process.exit(0)
})

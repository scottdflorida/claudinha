#!/usr/bin/env node
/**
 * claudinha-hook-relay.js — Windows-compatible Claude Code hook relay for Claudio.
 *
 * Works on all platforms. On Windows, connects to the named pipe path in
 * CLAUDINHA_SOCKET_PATH; on macOS/Linux the Unix domain socket path is used.
 *
 * Called by Claude Code's hook system with the event name as the first argument.
 * Reads JSON from stdin, injects routing fields, sends to HookListener.
 *
 * Environment variables (set by PtyPool at pane spawn time):
 *   CLAUDINHA_PANE_ID      — pane UUID for routing
 *   CLAUDINHA_SOCKET_PATH  — path to the Unix socket or Windows named pipe
 *
 * Always exits 0. Claude Code hook timeout is ~5s; we set a 2s connection timeout.
 */

'use strict'

const net = require('net')

const hookEvent = process.argv[2] || ''
const paneId = process.env.CLAUDINHA_PANE_ID || ''
const socketPath = process.env.CLAUDINHA_SOCKET_PATH || ''

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  if (!socketPath) process.exit(0)

  let payload = {}
  try {
    payload = input.trim() ? JSON.parse(input) : {}
  } catch {
    // Malformed JSON — send what we have
  }

  if (!payload.hookEventName && hookEvent) payload.hookEventName = hookEvent
  if (!payload.paneId && paneId) payload.paneId = paneId

  const msg = Buffer.from(JSON.stringify(payload) + '\n', 'utf8')

  const client = net.createConnection(socketPath)
  let done = false

  const finish = () => {
    if (done) return
    done = true
    try { client.destroy() } catch { /* ignore */ }
    process.exit(0)
  }

  const timer = setTimeout(finish, 2000)

  client.on('connect', () => {
    client.write(msg, () => {
      clearTimeout(timer)
      finish()
    })
  })

  client.on('error', () => {
    clearTimeout(timer)
    finish()
  })
})

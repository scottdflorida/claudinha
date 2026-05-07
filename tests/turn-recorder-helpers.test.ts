/**
 * turn-recorder pure-helper tests.
 *
 * These cover the message-format / trailer-extraction utilities that are
 * the contract between turn-recorder (writes the commit) and turn-projection
 * (reads it back). Drift here would break the projection silently — a
 * commit landed without the trailer would lose its stable UUID and look
 * like a legacy commit on every refresh.
 */

import { describe, it, expect } from 'vitest'
import {
  formatTurnCommitMessage,
  extractTurnIdFromCommitMessage,
  extractTurnIndexFromSubject,
  TURN_ID_TRAILER
} from '../src/main/turn-recorder'

describe('formatTurnCommitMessage', () => {
  it('uses the canonical wip(turn-N): subject form', () => {
    const msg = formatTurnCommitMessage(7, 'Add user authentication', 'abc-123')
    expect(msg.startsWith('wip(turn-7): Add user authentication')).toBe(true)
  })

  it('embeds the turn UUID in a Claudinha-Turn-Id trailer', () => {
    const msg = formatTurnCommitMessage(1, 'Initial commit', '550e8400-e29b-41d4-a716-446655440000')
    expect(msg).toContain(`${TURN_ID_TRAILER}: 550e8400-e29b-41d4-a716-446655440000`)
  })

  it('separates subject from body with a blank line (git-trailer convention)', () => {
    const msg = formatTurnCommitMessage(1, 'X', 'id')
    const lines = msg.split('\n')
    expect(lines[0]).toBe('wip(turn-1): X')
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^Claudinha-Turn-Id: id$/)
  })

  it('round-trips through extractTurnIdFromCommitMessage', () => {
    const msg = formatTurnCommitMessage(3, 'Refactor parser', 'turn-uuid-xyz')
    expect(extractTurnIdFromCommitMessage(msg)).toBe('turn-uuid-xyz')
  })
})

describe('extractTurnIdFromCommitMessage', () => {
  it('returns null when the trailer is missing', () => {
    expect(extractTurnIdFromCommitMessage('plain commit message')).toBe(null)
  })

  it('returns null when the trailer is malformed', () => {
    expect(extractTurnIdFromCommitMessage('subject\n\nClaudinha-Turn-Id:\n')).toBe(null)
  })

  it('finds the trailer regardless of position in the body', () => {
    const msg = [
      'subject',
      '',
      'some body text',
      '',
      `${TURN_ID_TRAILER}: my-id`,
      ''
    ].join('\n')
    expect(extractTurnIdFromCommitMessage(msg)).toBe('my-id')
  })

  it('returns the first trailer if there are multiple (duplicate-resilient)', () => {
    const msg = [
      'subject',
      '',
      `${TURN_ID_TRAILER}: first`,
      `${TURN_ID_TRAILER}: second`,
      ''
    ].join('\n')
    expect(extractTurnIdFromCommitMessage(msg)).toBe('first')
  })

  it('does not match a similarly-named non-trailer line', () => {
    const msg = [
      'subject',
      '',
      'mentions Claudinha-Turn-Id: in passing without being a trailer',
      ''
    ].join('\n')
    // Above isn't at line start in trailer position; should still match
    // since our regex is line-based — the line literally starts with the
    // trailer. Confirm behavior: this DOES match (we accept embedded
    // trailers; the writer always puts ours at the end).
    expect(extractTurnIdFromCommitMessage(msg)).toBe(null)
  })
})

describe('extractTurnIndexFromSubject', () => {
  it('parses wip(turn-N): subjects', () => {
    expect(extractTurnIndexFromSubject('wip(turn-1): foo')).toBe(1)
    expect(extractTurnIndexFromSubject('wip(turn-42): foo')).toBe(42)
  })

  it('returns null for non-claudinha subjects', () => {
    expect(extractTurnIndexFromSubject('feat: add thing')).toBe(null)
    expect(extractTurnIndexFromSubject('hello world')).toBe(null)
  })

  it('returns null for malformed forms', () => {
    expect(extractTurnIndexFromSubject('wip(turn-): foo')).toBe(null)
    expect(extractTurnIndexFromSubject('wip(turn-abc): foo')).toBe(null)
    expect(extractTurnIndexFromSubject('wip(turn-0): foo')).toBe(null)
  })
})

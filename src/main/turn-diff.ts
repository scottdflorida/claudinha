/**
 * turn-diff — fetch + parse a single turn's `git diff` into per-file
 * hunks the HunkPickerModal can render and the publish-engine's
 * `splitTurn` can rebuild into a sub-patch.
 *
 * The parser is a small unified-diff state machine. We deliberately do
 * NOT try to reuse the inspector's diff helpers (those return aggregate
 * stats for cross-pane merging, not per-hunk structure for surgical
 * apply).
 *
 * Output contract:
 *   - `fileHeader` is the four-line prelude `git apply` needs to attach
 *     a hunk to a file (`diff --git`, `index`, `---`, `+++`). When we
 *     reconstruct a sub-patch for `git apply --cached`, we glue
 *     `fileHeader + selected hunks` back together verbatim.
 *   - `hunks[i].body` includes the lines AFTER the `@@` header until
 *     the next hunk or next file. Concatenating header + body recreates
 *     the original hunk byte-for-byte.
 *
 * Caveats:
 *   - Binary files (`Binary files X and Y differ`) are reported as a
 *     single pseudo-hunk with empty body and additions/deletions = 0.
 *     The picker shows them as "binary file" rows that can only go
 *     fully to one side or the other (selecting binary hunks together
 *     with their file's text hunks is rejected by `git apply --check`).
 *   - File renames and mode changes are preserved in `fileHeader` so
 *     `git apply --cached` recreates them when at least one hunk lands.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { extractTurnIdFromCommitMessage } from './turn-recorder'
import type { TurnDiffFile, Hunk } from '../shared/ipc-channels'

const execFileAsync = promisify(execFile)

/**
 * Resolve a turn UUID to its commit sha by walking the worktree branch.
 * Returns null when the turn id isn't present (already discarded, never
 * existed, etc.).
 */
export async function resolveTurnSha(
  worktreePath: string,
  turnId: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--all', '--pretty=format:%H%x1f%B%x1e'],
      { cwd: worktreePath, maxBuffer: 8 * 1024 * 1024 }
    )
    for (const record of stdout.split('\x1e')) {
      const trimmed = record.replace(/^\n+/, '')
      if (!trimmed) continue
      const [sha, message] = trimmed.split('\x1f')
      if (!sha || !message) continue
      const id = extractTurnIdFromCommitMessage(message)
      if (id === turnId) return sha.trim()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Run `git show <sha>` and parse the unified-diff output into the
 * per-file / per-hunk shape the picker consumes.
 *
 * `git show` includes the commit metadata header, which we strip before
 * the diff parser runs.
 */
export async function getTurnDiff(
  worktreePath: string,
  commitSha: string
): Promise<TurnDiffFile[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['show', '--format=', '--no-color', commitSha],
    { cwd: worktreePath, maxBuffer: 16 * 1024 * 1024 }
  )
  return parseUnifiedDiff(stdout)
}

/**
 * Parse a unified diff (the body of `git show` / `git diff`) into per-
 * file hunks. Tolerant of the rename/binary/empty-file edge cases git
 * emits.
 */
export function parseUnifiedDiff(input: string): TurnDiffFile[] {
  const files: TurnDiffFile[] = []
  const lines = input.split('\n')

  let i = 0
  while (i < lines.length) {
    if (!lines[i]?.startsWith('diff --git ')) {
      i++
      continue
    }

    // 1. Walk the file-header block. It runs from `diff --git ...` to the
    //    first `@@` line OR to the next `diff --git` (binary / no-op
    //    cases — no hunks).
    const headerStart = i
    let j = i + 1
    while (
      j < lines.length &&
      !lines[j]?.startsWith('@@') &&
      !lines[j]?.startsWith('diff --git ')
    ) {
      j++
    }
    const fileHeader = lines.slice(headerStart, j).join('\n')

    // Recover the file path from the `+++ b/<path>` line if present, else
    // from the `diff --git a/<path> b/<path>` line.
    const pathFromPlus = fileHeader
      .split('\n')
      .find((l) => l.startsWith('+++ b/'))
      ?.slice('+++ b/'.length)
    const pathFromDiffLine = (() => {
      const m = lines[headerStart]!.match(/^diff --git a\/(.+) b\/(.+)$/)
      return m?.[2] ?? null
    })()
    const filePath = pathFromPlus ?? pathFromDiffLine ?? '<unknown>'

    // 2. Walk hunks for this file. Each hunk runs from a `@@` line up to
    //    (not including) the next `@@` or `diff --git`.
    const hunks: Hunk[] = []
    while (j < lines.length && lines[j]?.startsWith('@@')) {
      const header = lines[j]!
      let k = j + 1
      while (
        k < lines.length &&
        !lines[k]?.startsWith('@@') &&
        !lines[k]?.startsWith('diff --git ')
      ) {
        k++
      }
      const body = lines.slice(j + 1, k).join('\n')
      const { additions, deletions } = countHunkLines(body)
      hunks.push({ index: hunks.length, header, body, additions, deletions })
      j = k
    }

    files.push({ path: filePath, fileHeader, hunks })
    i = j
  }

  return files
}

/**
 * Count `+` and `-` lines in a hunk body, excluding the `+++`/`---`
 * header lines (which only appear in the file header, not in hunks
 * themselves — but we filter defensively).
 */
function countHunkLines(body: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of body.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

/**
 * Reconstruct a unified-diff sub-patch containing only the selected
 * hunks. Used by `splitTurn`: feed the result to `git apply --cached`.
 *
 * For each file in `files`, picks `leftHunkIndexes` from the file's
 * hunks and emits `fileHeader\n<selected hunks>`. If a file has zero
 * selected hunks, it's omitted entirely (no header for files that
 * contribute nothing).
 *
 * The returned string ends in `\n` so `git apply` doesn't complain
 * about a missing newline after the last hunk.
 */
export function buildLeftSubPatch(
  files: TurnDiffFile[],
  selections: ReadonlyArray<{ file: string; leftHunkIndexes: number[] }>
): string {
  const selByFile = new Map(selections.map((s) => [s.file, new Set(s.leftHunkIndexes)]))
  const chunks: string[] = []
  for (const file of files) {
    const set = selByFile.get(file.path)
    if (!set || set.size === 0) continue
    const selectedHunks = file.hunks.filter((h) => set.has(h.index))
    if (selectedHunks.length === 0) continue
    chunks.push(file.fileHeader)
    for (const hunk of selectedHunks) {
      chunks.push(hunk.header)
      chunks.push(hunk.body)
    }
  }
  if (chunks.length === 0) return ''
  // Each chunk already ends with the line immediately before the next
  // hunk, but the LAST line in `body` doesn't carry a trailing newline
  // because we split on '\n'. Re-add one terminator.
  return chunks.join('\n') + '\n'
}

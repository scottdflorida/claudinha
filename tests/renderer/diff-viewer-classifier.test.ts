import { describe, it, expect } from 'vitest'
import { classifyDiffLine } from '../../src/renderer/components/DiffViewerModal'

describe('classifyDiffLine', () => {
  it('classifies `diff --git` as file-header', () => {
    expect(classifyDiffLine('diff --git a/foo b/foo')).toBe('file-header')
  })

  it('classifies `index ...` as file-header', () => {
    expect(classifyDiffLine('index abc1234..def5678 100644')).toBe('file-header')
  })

  it('classifies `--- a/path` as file-header (not removed)', () => {
    // `--- ` precedence is critical: the one-char `-` rule would otherwise
    // mis-tag every file-path marker as a deletion.
    expect(classifyDiffLine('--- a/src/foo.ts')).toBe('file-header')
  })

  it('classifies `+++ b/path` as file-header (not added)', () => {
    // Same precedence concern as the `---` case.
    expect(classifyDiffLine('+++ b/src/foo.ts')).toBe('file-header')
  })

  it('classifies `@@ ... @@` as hunk-header', () => {
    expect(classifyDiffLine('@@ -1,3 +1,4 @@')).toBe('hunk-header')
    expect(classifyDiffLine('@@ -10,7 +12,9 @@ function foo() {')).toBe('hunk-header')
  })

  it('classifies `+foo` as added', () => {
    expect(classifyDiffLine('+const x = 1')).toBe('added')
    expect(classifyDiffLine('+')).toBe('added')
  })

  it('classifies `-foo` as removed', () => {
    expect(classifyDiffLine('-const x = 1')).toBe('removed')
    expect(classifyDiffLine('-')).toBe('removed')
  })

  it('classifies `\\ No newline at end of file` as meta', () => {
    expect(classifyDiffLine('\\ No newline at end of file')).toBe('meta')
  })

  it('classifies a leading-space context line as context', () => {
    expect(classifyDiffLine(' const y = 2')).toBe('context')
  })

  it('classifies an empty line as context', () => {
    expect(classifyDiffLine('')).toBe('context')
  })
})

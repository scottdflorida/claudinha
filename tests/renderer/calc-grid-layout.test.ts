// @vitest-environment happy-dom
import { calcGridLayout } from '../../src/renderer/components/PaneGrid'

describe('calcGridLayout', () => {
  it('returns 0x0 for zero panes', () => {
    expect(calcGridLayout(0)).toEqual({ numCols: 0, numRows: 0 })
  })

  it('returns 0x0 for negative input', () => {
    expect(calcGridLayout(-1)).toEqual({ numCols: 0, numRows: 0 })
  })

  it('returns 1x1 for 1 pane', () => {
    expect(calcGridLayout(1)).toEqual({ numCols: 1, numRows: 1 })
  })

  it('returns 2x1 for 2 panes', () => {
    expect(calcGridLayout(2)).toEqual({ numCols: 2, numRows: 1 })
  })

  it('returns 2x2 for 3 panes', () => {
    expect(calcGridLayout(3)).toEqual({ numCols: 2, numRows: 2 })
  })

  it('returns 2x2 for 4 panes', () => {
    expect(calcGridLayout(4)).toEqual({ numCols: 2, numRows: 2 })
  })

  it('returns 3x2 for 5 panes', () => {
    expect(calcGridLayout(5)).toEqual({ numCols: 3, numRows: 2 })
  })

  it('returns 3x2 for 6 panes', () => {
    expect(calcGridLayout(6)).toEqual({ numCols: 3, numRows: 2 })
  })

  it('returns 3x3 for 9 panes', () => {
    expect(calcGridLayout(9)).toEqual({ numCols: 3, numRows: 3 })
  })

  it('returns 4x3 for 10 panes', () => {
    expect(calcGridLayout(10)).toEqual({ numCols: 4, numRows: 3 })
  })

  it('returns 4x4 for 16 panes', () => {
    expect(calcGridLayout(16)).toEqual({ numCols: 4, numRows: 4 })
  })

  it('cols always >= rows (aspect ratio minimization)', () => {
    for (let n = 1; n <= 25; n++) {
      const { numCols, numRows } = calcGridLayout(n)
      expect(numCols).toBeGreaterThanOrEqual(numRows)
      expect(numCols * numRows).toBeGreaterThanOrEqual(n)
    }
  })
})

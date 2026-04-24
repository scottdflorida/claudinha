#!/usr/bin/env node
/**
 * Rasterize assets/icons/icon.svg to assets/icons/icon.png at 1024×1024.
 * electron-builder auto-generates .icns (mac) and .ico (win) from this PNG.
 *
 * Run after editing the SVG:
 *   npm run generate:icon
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const svgPath = resolve(repoRoot, 'assets/icons/icon.svg')
const pngPath = resolve(repoRoot, 'assets/icons/icon.png')
const SIZE = 1024

const { Resvg } = await import('@resvg/resvg-js')

const svg = await readFile(svgPath, 'utf8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: SIZE },
  background: 'rgba(0,0,0,0)'
})
const png = resvg.render().asPng()
await writeFile(pngPath, png)

console.log(`wrote ${pngPath} (${png.length} bytes, ${SIZE}×${SIZE})`)

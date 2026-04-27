#!/usr/bin/env node
/**
 * Rasterize assets/icons/icon.svg into two PNGs at 1024×1024:
 *
 *   - assets/icons/icon.png     — production icon
 *   - assets/icons/icon-dev.png — same base, with a "DEV" badge along the
 *                                 bottom of the squircle, used by the dev
 *                                 build's dock/taskbar icon to disambiguate
 *                                 it from an installed copy running side by
 *                                 side (see src/main/dev-mode.ts).
 *
 * electron-builder picks up icon.png and auto-generates .icns (mac) and
 * .ico (win) for the production bundle. The dev variant is only used at
 * runtime (app.dock.setIcon / BrowserWindow icon option), never bundled.
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
const devPngPath = resolve(repoRoot, 'assets/icons/icon-dev.png')
const SIZE = 1024

const { Resvg } = await import('@resvg/resvg-js')

// Inline SVG fragment for the "DEV" badge — a vivid orange band clipped to
// the squircle (which sits at 100,100→924,924 with rx=185 in the final
// canvas) so the band follows the rounded bottom corners. The 6px dark
// hairline at the band's top edge gives a hint of depth so the band reads
// as raised rather than pasted on.
const devBadgeFragment = `
  <defs>
    <clipPath id="devBadgeClip">
      <rect x="100" y="100" width="824" height="824" rx="185" ry="185"/>
    </clipPath>
  </defs>
  <g clip-path="url(#devBadgeClip)">
    <rect x="100" y="788" width="824" height="136" fill="#FF6B35"/>
    <rect x="100" y="788" width="824" height="6" fill="#000000" fill-opacity="0.20"/>
    <text x="512" y="892"
          font-family="Helvetica, Arial, sans-serif"
          font-size="110" font-weight="900"
          fill="#FFFFFF" text-anchor="middle"
          letter-spacing="14">DEV</text>
  </g>
`

function rasterize(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: SIZE },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }
  })
  return resvg.render().asPng()
}

const baseSvg = await readFile(svgPath, 'utf8')

// Production icon
const basePng = rasterize(baseSvg)
await writeFile(pngPath, basePng)
console.log(`wrote ${pngPath} (${basePng.length} bytes, ${SIZE}×${SIZE})`)

// Dev icon — splice the badge fragment in just before </svg>
const devSvg = baseSvg.replace('</svg>', `${devBadgeFragment}\n</svg>`)
const devPng = rasterize(devSvg)
await writeFile(devPngPath, devPng)
console.log(`wrote ${devPngPath} (${devPng.length} bytes, ${SIZE}×${SIZE})`)

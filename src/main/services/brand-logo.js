import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { initWasm, Resvg } from '@resvg/resvg-wasm'

const require = createRequire(import.meta.url)
let wasmReady

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const RASTER_WIDTH_PX = 600

// Word and Excel embed only PNG/JPEG. The saved SVG stays the source of truth; a transparent PNG is derived at export time.
export async function rasterizeSvgLogo(branding) {
  if (!branding || branding.logoMimeType !== 'image/svg+xml' || !branding.logoBase64) return branding
  const encoded = String(branding.logoBase64)
  if (encoded.length > 1024 * 1024) throw new Error('The saved SVG logo exceeds the export limit.')
  wasmReady ||= readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).then(initWasm)
  await wasmReady
  const svg = Buffer.from(encoded, 'base64').toString('utf8')
  let png
  try {
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: RASTER_WIDTH_PX }, font: { loadSystemFonts: false } }).render()
    png = Buffer.from(rendered.asPng())
  } catch (error) {
    throw new Error(`The saved SVG logo could not be converted to PNG: ${error.message}`)
  }
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE) || png.length > 750 * 1024) {
    throw new Error('The derived PNG logo is invalid or exceeds the export limit.')
  }
  return { ...branding, logoMimeType: 'image/png', logoBase64: png.toString('base64') }
}

export function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

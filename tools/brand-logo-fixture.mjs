import zlib from 'node:zlib'

// Synthetic 122x60 logo (the official Kreston viewBox proportions) with a transparent background and corners.
export const SYNTHETIC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122 60" width="122" height="60">'
  + '<path d="M20 4 L50 4 L36 30 L50 56 L20 56 L6 30 Z" fill="#2CCEE1"/>'
  + '<rect x="58" y="14" width="60" height="12" fill="#189CD8"/><rect x="58" y="34" width="44" height="12" fill="#243746"/></svg>'
export const SYNTHETIC_SVG_BASE64 = Buffer.from(SYNTHETIC_SVG, 'utf8').toString('base64')
export const SYNTHETIC_ASPECT = 122 / 60

// Reads size, colour type and the first pixel's alpha from a PNG (first row has no left/up neighbour, so pixel 0 is raw).
export function pngInfo(buffer) {
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const colorType = buffer[25]
  const chunks = []
  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  return { width, height, colorType, cornerAlpha: colorType === 6 ? raw[4] : null }
}

export function ratioWithin(actual, expected, tolerance = 0.02) {
  return Math.abs(actual / expected - 1) <= tolerance
}

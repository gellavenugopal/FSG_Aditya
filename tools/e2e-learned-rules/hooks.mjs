import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: pathToFileURL(path.join(here, 'electron-stub.mjs')).href, shortCircuit: true }
  return nextResolve(specifier, context)
}

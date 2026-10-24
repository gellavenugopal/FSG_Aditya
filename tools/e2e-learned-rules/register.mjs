// node --import ./register.mjs <script>  — routes `import ... from 'electron'` to the stub.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./hooks.mjs', import.meta.url)

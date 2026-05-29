// scripts/add-shebang.mjs
import { readFileSync, writeFileSync } from 'fs'
const f = 'dist/index.js'
const c = readFileSync(f, 'utf8')
if (!c.startsWith('#!/usr/bin/env node')) {
  writeFileSync(f, '#!/usr/bin/env node\n' + c)
}

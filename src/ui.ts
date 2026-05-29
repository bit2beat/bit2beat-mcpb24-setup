// src/ui.ts
import { bold, bgBlue, white, dim } from 'picocolors'

export function printHeader(): void {
  console.log()
  console.log(bgBlue(white(bold('  🔷  Bitrix24 MCP Setup   by bit2beat  '))))
  console.log(dim('  Conectá tu Bitrix24 con Claude'))
  console.log()
}

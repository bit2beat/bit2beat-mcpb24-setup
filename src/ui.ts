// src/ui.ts
import pc from 'picocolors'
const { bold, bgBlue, white, dim } = pc

export function printHeader(): void {
  console.log()
  console.log(bgBlue(white(bold('  🔷  Bitrix24 MCP Setup   by bit2beat  '))))
  console.log(dim('  Conectá tu Bitrix24 con Claude'))
  console.log()
}

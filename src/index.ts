#!/usr/bin/env node
// src/index.ts
import {
  intro, outro, select, text, spinner,
  confirm, note, isCancel, cancel,
} from '@clack/prompts'
import { green, red } from 'picocolors'
import { verifyToken } from './verify.js'
import { findDesktopConfig, writeDesktopConfig, getConfigJson } from './config-desktop.js'
import { printHeader } from './ui.js'

async function main(): Promise<void> {
  printHeader()
  intro('Configuración de Bitrix24 MCP para Claude')

  // ── Paso 1: cliente ─────────────────────────────────────────────────
  const client = await select({
    message: '¿Qué cliente querés configurar?',
    options: [
      { value: 'desktop', label: 'Claude Desktop  (app de escritorio)' },
      { value: 'web',     label: 'Claude.ai  (web)' },
      { value: 'both',    label: 'Ambos' },
    ],
  })
  if (isCancel(client)) { cancel('Setup cancelado.'); process.exit(0) }

  // ── Paso 2: token con verificación ──────────────────────────────────
  let portalDomain: string | null = null
  let token = ''

  while (!portalDomain) {
    const inputToken = await text({
      message: 'Pegá tu token de b24-mcp:',
      placeholder: 'b24lite_...',
      validate: (v) => !v.startsWith('b24lite_') ? 'El token debe comenzar con b24lite_' : undefined,
    })
    if (isCancel(inputToken)) { cancel('Setup cancelado.'); process.exit(0) }
    token = inputToken as string

    const s = spinner()
    s.start('Verificando token...')
    const result = await verifyToken(token)

    if (result.valid && result.portalDomain) {
      s.stop(green(`✔ Token válido — portal: ${result.portalDomain}`))
      portalDomain = result.portalDomain
    } else {
      s.stop(red('✗ Token inválido. Revisá que sea correcto.'))
      const retry = await confirm({ message: '¿Intentar con otro token?' })
      if (!retry || isCancel(retry)) { cancel('Setup cancelado.'); process.exit(0) }
    }
  }

  // ── Paso 3: nombre de conexión ───────────────────────────────────────
  const defaultName = portalDomain.split('.')[0]
  const nameInput = await text({
    message: 'Nombre para esta conexión: (podés tener varias)',
    placeholder: defaultName,
    defaultValue: defaultName,
    validate: (v) => !v.trim() ? 'El nombre no puede estar vacío' : undefined,
  })
  if (isCancel(nameInput)) { cancel('Setup cancelado.'); process.exit(0) }
  const name = (nameInput as string).trim()

  // ── Paso 4: configurar Desktop ───────────────────────────────────────
  const doDesktop = client === 'desktop' || client === 'both'
  const doWeb     = client === 'web'     || client === 'both'

  if (doDesktop) {
    const configPath = findDesktopConfig()

    if (configPath) {
      let result = writeDesktopConfig(configPath, name, token, false)

      if (result.existed) {
        const overwrite = await confirm({
          message: `Ya existe una conexión con el nombre "${name}". ¿Sobreescribir?`,
        })
        if (isCancel(overwrite) || !overwrite) {
          note('Conexión no modificada.', 'Claude Desktop')
        } else {
          writeDesktopConfig(configPath, name, token, true)
          note(`✔ Conexión "${name}" actualizada\n→ Reiniciá Claude Desktop para activar los cambios`, 'Claude Desktop')
        }
      } else {
        note(`✔ Conexión "${name}" guardada\n→ Reiniciá Claude Desktop para activarla`, 'Claude Desktop')
      }
    } else {
      note(
        `No encontré claude_desktop_config.json.\n\nAgregá esto manualmente en el archivo de configuración de Claude Desktop:\n\n${getConfigJson(name, token)}`,
        'Claude Desktop — Configuración manual',
      )
    }
  }

  // ── Paso 5: instrucciones Claude.ai web ─────────────────────────────
  if (doWeb) {
    note(
      `Agregá en Claude.ai → Settings → Integrations → Add integration:\n\n  URL:    https://b24mcp-app.bit2beat.com/lite/mcp\n  Header: Authorization: Bearer ${token}`,
      'Claude.ai Web',
    )
  }

  outro(green('¡Todo listo! Bitrix24 ya está conectado a Claude.'))
}

main().catch((err: unknown) => {
  console.error('Error inesperado:', err)
  process.exit(1)
})

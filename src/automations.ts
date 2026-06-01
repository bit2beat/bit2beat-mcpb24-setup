import { intro, outro, text, spinner, note, isCancel, cancel } from '@clack/prompts'
import { execSync } from 'node:child_process'
import pc from 'picocolors'
const { green, red } = pc
import { verifyToken } from './verify.js'
import { getFeatures } from './features.js'
import { installSkill, type SkillClient } from './skill-install.js'
import { printHeader } from './ui.js'

function pythonOk(): boolean {
  try {
    execSync('python3 -c "import phpserialize"', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export async function runAutomations(client: SkillClient): Promise<void> {
  printHeader()
  intro('Instalación de la skill de Automatizaciones')

  const checks: string[] = []

  const pyOk = pythonOk()
  checks.push(`${pyOk ? '✅' : '❌'} Python 3 + phpserialize`)

  const tokenInput = await text({
    message: 'Pegá tu token de b24-mcp:',
    placeholder: 'b24lite_...',
    validate: (v) => !v.startsWith('b24lite_') ? 'Debe empezar con b24lite_' : undefined,
  })
  if (isCancel(tokenInput)) { cancel('Cancelado.'); process.exit(0) }
  const token = tokenInput as string

  const s = spinner()
  s.start('Verificando token y plan...')
  const verify = await verifyToken(token)
  const features = verify.valid ? await getFeatures(token) : { automations: false }
  s.stop(verify.valid ? green('✔ Token válido') : red('✗ Token inválido'))

  checks.push(`${verify.valid ? '✅' : '❌'} Token MCP válido`)
  checks.push(`${features.automations ? '✅' : '❌'} Plan incluye automatizaciones`)

  note(checks.join('\n'), 'Requisitos')

  if (!verify.valid) { outro(red('Token inválido. No se instaló la skill.')); return }
  if (!features.automations) {
    outro(red('Tu plan no incluye automatizaciones. No se instaló la skill.'))
    return
  }
  if (!pyOk) {
    note('Instalá Python 3 y luego: pip install phpserialize\nVolvé a correr el comando.', 'Falta Python')
    outro(red('No se instaló la skill (falta Python).'))
    return
  }

  const dir = installSkill(client)
  note(
    `Skill instalada en:\n  ${dir}\n\nProbá en Claude:\n  "detallá las automatizaciones de mi portal"\n  "exportá la automatización de la etapa X"`,
    'Listo',
  )
  outro(green('¡Skill de automatizaciones instalada!'))
}

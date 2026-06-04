import { intro, outro, text, spinner, note, isCancel, cancel } from '@clack/prompts'
import { execSync } from 'node:child_process'
import pc from 'picocolors'
const { green, red, yellow } = pc
import { verifyToken } from './verify.js'
import { getFeatures, FALLBACK } from './features.js'
import { installSkill, type SkillClient } from './skill-install.js'
import { printHeader } from './ui.js'

const KNOWN_SKILLS = ['portal-scout', 'bizproc', 'catalog-importer']

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
  intro('Instalación de skills de bit2beat')

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
  const features = verify.valid ? await getFeatures(token) : FALLBACK
  s.stop(verify.valid ? green('✔ Token válido') : red('✗ Token inválido'))

  const allowed = Object.entries(features.skills)
    .filter(([, v]) => v)
    .map(([k]) => k)

  checks.push(`${verify.valid ? '✅' : '❌'} Token MCP válido`)
  for (const skill of KNOWN_SKILLS) {
    checks.push(`${allowed.includes(skill) ? '✅' : '❌'} Plan incluye skill: ${skill}`)
  }

  note(checks.join('\n'), 'Requisitos')

  if (!verify.valid) { outro(red('Token inválido. No se instalaron skills.')); return }

  if (allowed.length === 0) {
    outro(red('Tu plan no incluye skills. Necesitás el plan Pro para acceder a las skills de bit2beat.'))
    return
  }

  // bizproc needs Python + phpserialize; warn but still install the others
  const wantsBizproc = allowed.includes('bizproc')
  const effectiveAllowed = (!pyOk && wantsBizproc)
    ? allowed.filter(s => s !== 'bizproc')
    : allowed

  if (wantsBizproc && !pyOk) {
    note(
      'La skill bizproc requiere Python 3 y phpserialize.\nInstalá Python 3 y luego: pip install phpserialize\nVolvé a correr el comando para instalarla.\n\nEl resto de las skills se instalarán ahora.',
      yellow('Aviso — falta Python para bizproc'),
    )
    if (effectiveAllowed.length === 0) {
      outro(red('No quedaron skills para instalar (bizproc es la única permitida y falta Python).'))
      return
    }
  }

  const installed = installSkill(client, effectiveAllowed)

  const skillDir = `~/.claude/skills`
  const installedLines = installed.map(s => `  ✅ ${s}`).join('\n')
  const notAllowed = KNOWN_SKILLS.filter(s => !allowed.includes(s))
  const proLines = notAllowed.length
    ? '\nRequieren plan Pro:\n' + notAllowed.map(s => `  🔒 ${s}`).join('\n')
    : ''

  note(
    `Skills instaladas en:\n  ${skillDir}\n\n${installedLines}${proLines}\n\nProbá en Claude:\n  "detallá las automatizaciones de mi portal"\n  "exportá la automatización de la etapa X"`,
    'Listo',
  )
  outro(green(`¡${installed.length} skill(s) de bit2beat instalada(s)!`))
}

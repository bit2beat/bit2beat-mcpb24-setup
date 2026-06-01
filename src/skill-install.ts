import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SkillClient = 'code' | 'desktop'

// Carpeta de skills por cliente (Claude Code y Desktop leen de ~/.claude/skills)
export function getSkillDir(_client: SkillClient): string {
  return path.join(os.homedir(), '.claude', 'skills', 'b24-automations')
}

// La skill viene bundled en dist/../skill (resuelto relativo al módulo)
function bundledSkillDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, '..', 'skill')
}

export function installSkill(client: SkillClient): string {
  const target = getSkillDir(client)
  const source = bundledSkillDir()
  fs.mkdirSync(target, { recursive: true })
  for (const file of fs.readdirSync(source)) {
    if (file === 'samples' || file === 'FORMAT_NOTES.md' || file === 'test_parser.py') continue
    fs.copyFileSync(path.join(source, String(file)), path.join(target, String(file)))
  }
  return target
}

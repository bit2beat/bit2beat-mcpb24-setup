import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SkillClient = 'code' | 'desktop'

// Claude Code y Desktop leen las skills de ~/.claude/skills
export function getSkillDir(_client: SkillClient): string {
  return path.join(os.homedir(), '.claude', 'skills')
}

// Las skills vienen bundled en dist/../skills (resuelto relativo al módulo)
export function bundledSkillsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, '..', 'skills')
}

export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'samples' || entry.name === 'FORMAT_NOTES.md') continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

export function installSkill(client: SkillClient, allowedSkills: string[]): string[] {
  const target = getSkillDir(client)
  const src = bundledSkillsDir()
  const installed: string[] = []
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!allowedSkills.includes(entry.name)) continue
    copyDirRecursive(path.join(src, entry.name), path.join(target, entry.name))
    installed.push(entry.name)
  }
  return installed
}

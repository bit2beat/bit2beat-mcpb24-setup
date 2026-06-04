import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'

vi.mock('node:fs')
vi.mock('node:os')

const { getSkillDir, installSkill } = await import('../src/skill-install.js')

describe('getSkillDir', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })
  it('returns the claude skills root dir', () => {
    expect(getSkillDir('code')).toMatch(/\.claude[\\/]skills$/)
  })
})

describe('installSkill', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })

  it('copies skill tree recursively, skipping samples/FORMAT_NOTES.md', () => {
    let firstCall = true
    vi.mocked(fs.readdirSync).mockImplementation((() => {
      if (!firstCall) return [] as never
      firstCall = false
      return [
        { name: 'portal-scout', isDirectory: () => true },
        { name: 'SKILL.md', isDirectory: () => false },
        { name: 'samples', isDirectory: () => true },
        { name: 'FORMAT_NOTES.md', isDirectory: () => false },
      ] as never
    }) as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    const cp = vi.mocked(fs.copyFileSync).mockImplementation(() => {})
    installSkill('code')
    const copied = cp.mock.calls.map(c => String(c[1]))
    // SKILL.md at root level is copied
    expect(copied.some(p => p.endsWith('SKILL.md'))).toBe(true)
    // samples and FORMAT_NOTES.md are skipped
    expect(copied.some(p => p.includes('samples'))).toBe(false)
    expect(copied.some(p => p.endsWith('FORMAT_NOTES.md'))).toBe(false)
  })
})

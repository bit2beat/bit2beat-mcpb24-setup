import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'

vi.mock('node:fs')
vi.mock('node:os')

const { getSkillDir, installSkill } = await import('../src/skill-install.js')

describe('getSkillDir', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })

  it('returns claude skills dir', () => {
    expect(getSkillDir('code')).toContain('.claude')
  })
})

describe('installSkill', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })

  it('copies skill files to target dir', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['skill.md', 'parser.py'] as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    const cp = vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    installSkill('code')

    expect(fs.mkdirSync).toHaveBeenCalled()
    expect(cp).toHaveBeenCalled()
  })
})

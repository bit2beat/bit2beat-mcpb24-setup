import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'

vi.mock('node:fs')
vi.mock('node:os')

const { getSkillDir, installSkill } = await import('../src/skill-install.js')

describe('getSkillDir', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })

  it('returns claude skills dir', () => {
    expect(getSkillDir('code')).toMatch(/\.claude[\\/]skills[\\/]b24-automations$/)
  })
})

describe('installSkill', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(os.homedir).mockReturnValue('/home/u') })

  it('copies skill files but skips samples, FORMAT_NOTES.md, test_parser.py', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue([
      'skill.md', 'parser.py', 'activities_catalog.json', 'url_patterns.json',
      'samples', 'FORMAT_NOTES.md', 'test_parser.py',
    ] as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    const cp = vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    installSkill('code')

    const copiedSources = cp.mock.calls.map(c => String(c[0]))
    // incluidos
    expect(copiedSources.some(p => p.endsWith('skill.md'))).toBe(true)
    expect(copiedSources.some(p => p.endsWith('parser.py'))).toBe(true)
    // excluidos
    expect(copiedSources.some(p => p.endsWith('samples'))).toBe(false)
    expect(copiedSources.some(p => p.endsWith('FORMAT_NOTES.md'))).toBe(false)
    expect(copiedSources.some(p => p.endsWith('test_parser.py'))).toBe(false)
  })
})

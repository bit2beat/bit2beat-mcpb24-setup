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

  it('copies only allowed skill subdirs', () => {
    // First call = bundledSkillsDir listing; subsequent calls = recursive reads (return empty)
    let firstCall = true
    vi.mocked(fs.readdirSync).mockImplementation((() => {
      if (!firstCall) return [] as never
      firstCall = false
      return [
        { name: 'portal-scout', isDirectory: () => true },
        { name: 'bizproc', isDirectory: () => true },
        { name: 'catalog-importer', isDirectory: () => true },
      ] as never
    }) as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    const installed = installSkill('code', ['portal-scout'])

    expect(installed).toEqual(['portal-scout'])
    // mkdirSync called for portal-scout target only
    const mkdirCalls = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]))
    expect(mkdirCalls.some(p => p.includes('portal-scout'))).toBe(true)
    expect(mkdirCalls.some(p => p.includes('bizproc'))).toBe(false)
    expect(mkdirCalls.some(p => p.includes('catalog-importer'))).toBe(false)
  })

  it('returns empty array when no skills are allowed', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'portal-scout', isDirectory: () => true },
      { name: 'bizproc', isDirectory: () => true },
    ] as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    const installed = installSkill('code', [])
    expect(installed).toEqual([])
    expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled()
  })

  it('copies multiple allowed skills when all are in allowlist', () => {
    let firstCall = true
    vi.mocked(fs.readdirSync).mockImplementation((() => {
      if (!firstCall) return [] as never
      firstCall = false
      return [
        { name: 'portal-scout', isDirectory: () => true },
        { name: 'bizproc', isDirectory: () => true },
        { name: 'catalog-importer', isDirectory: () => true },
      ] as never
    }) as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    const installed = installSkill('code', ['portal-scout', 'bizproc', 'catalog-importer'])
    expect(installed).toEqual(['portal-scout', 'bizproc', 'catalog-importer'])
  })

  it('skips non-directory entries regardless of allowlist', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'portal-scout', isDirectory: () => false }, // file, not dir
      { name: 'README.md', isDirectory: () => false },
    ] as never)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never)
    vi.mocked(fs.copyFileSync).mockImplementation(() => {})

    const installed = installSkill('code', ['portal-scout'])
    expect(installed).toEqual([])
  })
})

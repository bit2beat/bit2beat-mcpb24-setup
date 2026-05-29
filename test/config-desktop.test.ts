// test/config-desktop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'

vi.mock('node:fs')
vi.mock('node:os')

// Import AFTER mocking
const { findDesktopConfig, writeDesktopConfig } = await import('../src/config-desktop.js')

describe('findDesktopConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns path on macOS when file exists', () => {
    vi.mocked(os.platform).mockReturnValue('darwin')
    vi.mocked(os.homedir).mockReturnValue('/Users/test')
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const result = findDesktopConfig()

    expect(result).toBe('/Users/test/Library/Application Support/Claude/claude_desktop_config.json')
  })

  it('returns path on Windows when file exists', () => {
    vi.mocked(os.platform).mockReturnValue('win32')
    vi.mocked(os.homedir).mockReturnValue('C:\\Users\\test')
    vi.stubEnv('APPDATA', 'C:\\Users\\test\\AppData\\Roaming')
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const result = findDesktopConfig()

    expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
  })

  it('returns null when file does not exist', () => {
    vi.mocked(os.platform).mockReturnValue('darwin')
    vi.mocked(os.homedir).mockReturnValue('/Users/test')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = findDesktopConfig()

    expect(result).toBeNull()
  })
})

describe('writeDesktopConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates new config when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('/path/config.json', 'miportal', 'b24lite_tok', false)

    expect(result.existed).toBe(false)
    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal).toEqual({
      type: 'http',
      url: 'https://b24mcp-app.bit2beat.com/lite/mcp',
      headers: { Authorization: 'Bearer b24lite_tok' },
    })
  })

  it('merges with existing connections without overwriting them', () => {
    const existing = { mcpServers: { other: { type: 'http', url: 'https://other.com' } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    writeDesktopConfig('/path/config.json', 'miportal', 'b24lite_tok', false)

    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.other).toBeDefined()
    expect(written.mcpServers.miportal).toBeDefined()
  })

  it('returns existed=true when name already exists and overwrite=false', () => {
    const existing = { mcpServers: { miportal: { type: 'http', url: 'https://b24mcp-app.bit2beat.com/lite/mcp' } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('/path/config.json', 'miportal', 'b24lite_tok', false)

    expect(result.existed).toBe(true)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('overwrites when overwrite=true', () => {
    const existing = { mcpServers: { miportal: { type: 'http', url: 'https://old.com' } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('/path/config.json', 'miportal', 'b24lite_newtok', true)

    expect(result.existed).toBe(false)
    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal.headers.Authorization).toBe('Bearer b24lite_newtok')
  })
})

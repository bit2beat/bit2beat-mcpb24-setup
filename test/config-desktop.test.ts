// test/config-desktop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'

vi.mock('node:fs')
vi.mock('node:os')

// Import AFTER mocking
const { writeDesktopConfig, writeClaudeCodeConfig } = await import('../src/config-desktop.js')

describe('writeDesktopConfig (macOS/Linux)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(os.platform).mockReturnValue('darwin')
    vi.mocked(os.homedir).mockReturnValue('/Users/test')
  })

  it('creates new config with npx + mcp-remote bridge', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('miportal', 'b24lite_tok', false)

    expect(result.existed).toBe(false)
    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal).toEqual({
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@0.1.38',
        'https://b24-mcp.bit2beat.com/lite/mcp',
        '--header',
        'Authorization: Bearer b24lite_tok',
      ],
    })
  })

  it('merges with existing connections without overwriting them', () => {
    const existing = { mcpServers: { other: { command: 'npx', args: [] } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    writeDesktopConfig('miportal', 'b24lite_tok', false)

    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.other).toBeDefined()
    expect(written.mcpServers.miportal).toBeDefined()
  })

  it('returns existed=true when name already exists and overwrite=false', () => {
    const existing = { mcpServers: { miportal: { command: 'npx', args: [] } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('miportal', 'b24lite_tok', false)

    expect(result.existed).toBe(true)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('writeDesktopConfig (Windows)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(os.platform).mockReturnValue('win32')
    vi.mocked(os.homedir).mockReturnValue('C:\\Users\\test')
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\test\\AppData\\Local')
    vi.stubEnv('APPDATA', 'C:\\Users\\test\\AppData\\Roaming')
  })

  it('uses cmd /c npx with token in env (Windows-safe pattern)', () => {
    // No Packages dir → classic install path
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('no dir') })
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    writeDesktopConfig('miportal', 'b24lite_tok', false)

    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal).toEqual({
      command: 'cmd',
      args: [
        '/c',
        'npx',
        '-y',
        'mcp-remote@0.1.38',
        'https://b24-mcp.bit2beat.com/lite/mcp',
        '--header',
        'Authorization:${AUTH_HEADER}',
      ],
      env: { AUTH_HEADER: 'Bearer b24lite_tok' },
      windowsHide: true,
    })
  })

  it('detects MSIX package path by glob', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['Claude_pzs8sxrjxfjjc'] as never)
    // MSIX Claude dir exists; target file does not yet
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p).includes('LocalCache') && String(p).endsWith('Claude'),
    )
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    writeDesktopConfig('miportal', 'b24lite_tok', false)

    const writtenPath = writeMock.mock.calls[0][0] as string
    expect(writtenPath).toContain('Packages')
    expect(writtenPath).toContain('Claude_pzs8sxrjxfjjc')
    expect(writtenPath).toContain('LocalCache')
  })
})

describe('writeClaudeCodeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(os.platform).mockReturnValue('darwin')
    vi.mocked(os.homedir).mockReturnValue('/Users/test')
  })

  it('writes native http format to ~/.claude.json', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeClaudeCodeConfig('miportal', 'b24lite_tok', false)

    expect(result.existed).toBe(false)
    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal).toEqual({
      type: 'http',
      url: 'https://b24-mcp.bit2beat.com/lite/mcp',
      headers: { Authorization: 'Bearer b24lite_tok' },
    })
  })

  it('preserves existing keys in the config file', () => {
    const existing = { numStartups: 5, mcpServers: { other: { type: 'http', url: 'x' } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    writeClaudeCodeConfig('miportal', 'b24lite_tok', false)

    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.numStartups).toBe(5)
    expect(written.mcpServers.other).toBeDefined()
    expect(written.mcpServers.miportal).toBeDefined()
  })
})

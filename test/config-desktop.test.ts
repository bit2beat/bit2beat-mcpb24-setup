// test/config-desktop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as child_process from 'node:child_process'

vi.mock('node:fs')
vi.mock('node:os')
vi.mock('node:child_process')

// Import AFTER mocking
const { writeDesktopConfig, writeClaudeCodeConfig } = await import('../src/config-desktop.js')

describe('writeDesktopConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Non-Windows so resolveNpxCommand returns plain "npx"
    vi.mocked(os.platform).mockReturnValue('darwin')
    vi.mocked(os.homedir).mockReturnValue('/Users/test')
  })

  it('creates new config with mcp-remote bridge when file does not exist', () => {
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

  it('overwrites when overwrite=true', () => {
    const existing = { mcpServers: { miportal: { command: 'old', args: [] } } }
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing))
    const writeMock = vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    const result = writeDesktopConfig('miportal', 'b24lite_newtok', true)

    expect(result.existed).toBe(false)
    const written = JSON.parse(writeMock.mock.calls[0][1] as string)
    expect(written.mcpServers.miportal.args).toContain('Authorization: Bearer b24lite_newtok')
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

// silence unused import warning for child_process mock
void child_process

// src/config-desktop.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const MCP_URL = 'https://b24-mcp.bit2beat.com/lite/mcp'

// Claude Code supports native HTTP transport
interface HttpMcpServer {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

// Claude Desktop needs an stdio bridge (mcp-remote)
interface StdioMcpServer {
  command: string
  args: string[]
}

type McpServer = HttpMcpServer | StdioMcpServer

export interface WriteResult {
  existed: boolean
}

// ─── npx resolution (Windows-safe) ───────────────────────────────────────────

/**
 * On Windows, returns the 8.3 short path of npx.cmd to avoid the
 * "C:\Program Files" space bug when Claude Desktop wraps the command in cmd /C.
 * On macOS/Linux, plain "npx" works fine.
 */
function resolveNpxCommand(): string {
  if (os.platform() !== 'win32') return 'npx'

  try {
    const located = execSync('where npx.cmd', { encoding: 'utf-8' })
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)[0]
    if (!located) return 'npx'

    const short = execSync(`for %I in ("${located}") do @echo %~sI`, {
      encoding: 'utf-8',
      shell: 'cmd.exe',
    }).trim()

    return short || located
  } catch {
    return 'npx'
  }
}

// ─── Claude Desktop config path (MSIX-aware on Windows) ───────────────────────

export function getDesktopConfigPath(): string {
  const platform = os.platform()
  const home = os.homedir()

  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local')
    const msixDir = path.win32.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc')
    // MSIX install reads from the virtualized LocalCache path
    if (fs.existsSync(msixDir)) {
      return path.win32.join(msixDir, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')
    }
    const appData = process.env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(appData, 'Claude', 'claude_desktop_config.json')
  }

  return path.posix.join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

// ─── Claude Desktop (stdio bridge via mcp-remote) ─────────────────────────────

function desktopServerEntry(token: string): StdioMcpServer {
  return {
    command: resolveNpxCommand(),
    args: [
      '-y',
      'mcp-remote',
      MCP_URL,
      '--header',
      `Authorization: Bearer ${token}`,
    ],
  }
}

export function writeDesktopConfig(name: string, token: string, overwrite: boolean): WriteResult {
  const configPath = getDesktopConfigPath()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> = {}

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      config = {}
    }
  }

  if (!config.mcpServers) config.mcpServers = {}
  const servers = config.mcpServers as Record<string, McpServer>

  if (name in servers && !overwrite) {
    return { existed: true }
  }

  servers[name] = desktopServerEntry(token)

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return { existed: false }
}

export function getConfigJson(name: string, token: string): string {
  const config = { mcpServers: { [name]: desktopServerEntry(token) } }
  return JSON.stringify(config, null, 2)
}

// ─── Claude Code (native HTTP, ~/.claude.json) ────────────────────────────────

export function getClaudeCodeConfigPath(): string {
  const home = os.homedir()
  return os.platform() === 'win32'
    ? path.win32.join(home, '.claude.json')
    : path.posix.join(home, '.claude.json')
}

export function writeClaudeCodeConfig(name: string, token: string, overwrite: boolean): WriteResult {
  const configPath = getClaudeCodeConfigPath()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> = {}

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      config = {}
    }
  }

  if (!config.mcpServers) config.mcpServers = {}
  const servers = config.mcpServers as Record<string, McpServer>

  if (name in servers && !overwrite) {
    return { existed: true }
  }

  servers[name] = {
    type: 'http',
    url: MCP_URL,
    headers: { Authorization: `Bearer ${token}` },
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return { existed: false }
}

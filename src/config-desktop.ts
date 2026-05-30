// src/config-desktop.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const MCP_URL = 'https://b24-mcp.bit2beat.com/lite/mcp'

interface McpServer {
  type: string
  url: string
  headers?: Record<string, string>
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpServer>
}

export function findDesktopConfig(): string | null {
  const platform = os.platform()
  const home = os.homedir()

  let configPath: string
  if (platform === 'darwin') {
    configPath = path.posix.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming')
    configPath = path.win32.join(appData, 'Claude', 'claude_desktop_config.json')
  } else {
    configPath = path.posix.join(home, '.config', 'Claude', 'claude_desktop_config.json')
  }

  return fs.existsSync(configPath) ? configPath : null
}

export function findClaudeCodeConfig(): string | null {
  const platform = os.platform()
  const home = os.homedir()

  const configPath = platform === 'win32'
    ? path.win32.join(home, '.claude', 'settings.json')
    : path.posix.join(home, '.claude', 'settings.json')

  return fs.existsSync(configPath) ? configPath : null
}

export function getClaudeCodeConfigPath(): string {
  const platform = os.platform()
  const home = os.homedir()
  return platform === 'win32'
    ? path.win32.join(home, '.claude', 'settings.json')
    : path.posix.join(home, '.claude', 'settings.json')
}

export interface WriteResult {
  existed: boolean
}

export function writeDesktopConfig(
  configPath: string,
  name: string,
  token: string,
  overwrite: boolean,
): WriteResult {
  let config: ClaudeConfig = {}

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ClaudeConfig
    } catch {
      config = {}
    }
  }

  if (!config.mcpServers) config.mcpServers = {}

  if (name in config.mcpServers && !overwrite) {
    return { existed: true }
  }

  config.mcpServers[name] = {
    type: 'http',
    url: MCP_URL,
    headers: { Authorization: `Bearer ${token}` },
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return { existed: false }
}

export function getConfigJson(name: string, token: string): string {
  const config: ClaudeConfig = {
    mcpServers: {
      [name]: {
        type: 'http',
        url: MCP_URL,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }
  return JSON.stringify(config, null, 2)
}

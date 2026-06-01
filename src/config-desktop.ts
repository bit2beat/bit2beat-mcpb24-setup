// src/config-desktop.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const MCP_URL = 'https://b24-mcp.bit2beat.com/lite/mcp'

// Versiones de mcp-remote según la versión de Node disponible:
//  - Node 20+  → 0.1.38 (usa undici 7, requiere Node 20.18.1+)
//  - Node 18-19 → 0.1.25 (última que usa fetch nativo, compatible con Node 18)
const MCP_REMOTE_MODERN = 'mcp-remote@0.1.38'
const MCP_REMOTE_LEGACY = 'mcp-remote@0.1.25'
const MIN_NODE_MODERN = 20

function getNodeMajor(): number | null {
  try {
    const raw = execSync('node --version', { encoding: 'utf-8' }).trim() // ej: v20.11.1
    const major = parseInt(raw.replace(/^v/, '').split('.')[0], 10)
    return Number.isFinite(major) ? major : null
  } catch {
    return null
  }
}

/** Elige la versión de mcp-remote compatible con el Node instalado. */
function pickMcpRemote(): string {
  const major = getNodeMajor()
  if (major !== null && major < MIN_NODE_MODERN) return MCP_REMOTE_LEGACY
  return MCP_REMOTE_MODERN
}

// Claude Code supports native HTTP transport
interface HttpMcpServer {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

// Claude Desktop needs an stdio bridge (mcp-remote spawned via node)
interface StdioMcpServer {
  command: string
  args: string[]
  env?: Record<string, string>
  windowsHide?: boolean
}

type McpServer = HttpMcpServer | StdioMcpServer

export interface WriteResult {
  existed: boolean
}

export type NodeCheck =
  | { ok: true; legacy: boolean } // legacy=true → Node 18-19 (usa mcp-remote viejo)
  | { ok: false; reason: 'missing' }

/**
 * Claude Desktop spawns `npx mcp-remote` localmente, que necesita Node.
 * Verifica que npx exista. `legacy` indica si el Node es 18-19 (soportado,
 * pero EOL — conviene actualizar a 20+).
 */
export function checkNode(): NodeCheck {
  try {
    const cmd = os.platform() === 'win32' ? 'where npx' : 'command -v npx'
    execSync(cmd, { stdio: 'ignore' })
  } catch {
    return { ok: false, reason: 'missing' }
  }

  const major = getNodeMajor()
  return { ok: true, legacy: major !== null && major < MIN_NODE_MODERN }
}

// ─── Claude Desktop config path (install-type agnostic on Windows) ────────────

export function getDesktopConfigPath(): string {
  const platform = os.platform()
  const home = os.homedir()

  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local')
    const packagesDir = path.win32.join(localAppData, 'Packages')

    // MSIX / Store install: virtualized path under Packages\Claude*\LocalCache\Roaming\Claude
    try {
      const claudePkg = fs.readdirSync(packagesDir).find(e => e.startsWith('Claude'))
      if (claudePkg) {
        const msixClaudeDir = path.win32.join(packagesDir, claudePkg, 'LocalCache', 'Roaming', 'Claude')
        if (fs.existsSync(msixClaudeDir)) {
          return path.win32.join(msixClaudeDir, 'claude_desktop_config.json')
        }
      }
    } catch {
      // Packages dir not readable — fall through to classic install path
    }

    // Classic .exe install
    const appData = process.env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(appData, 'Claude', 'claude_desktop_config.json')
  }

  return path.posix.join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

// ─── Claude Desktop server entry (stdio bridge) ───────────────────────────────

function desktopServerEntry(token: string): StdioMcpServer {
  const mcpRemote = pickMcpRemote()

  if (os.platform() === 'win32') {
    // Windows-safe pattern:
    //  - "cmd /c npx" so cmd resolves npx from PATH (no 8.3 short-name dependency)
    //  - token in env via ${AUTH_HEADER} so no arg contains a space (avoids Windows arg-splitting bug)
    //  - windowsHide so no console window flashes
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', mcpRemote, MCP_URL, '--header', 'Authorization:${AUTH_HEADER}'],
      env: { AUTH_HEADER: `Bearer ${token}` },
      windowsHide: true,
    }
  }

  // macOS / Linux: npx is directly spawnable, no space issues
  return {
    command: 'npx',
    args: ['-y', mcpRemote, MCP_URL, '--header', `Authorization: Bearer ${token}`],
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

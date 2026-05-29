// src/verify.ts
const VERIFY_URL = 'https://b24mcp-app.bit2beat.com/lite/verify'

export interface VerifyResult {
  valid: boolean
  portalDomain: string | null
  networkError: boolean
}

export async function verifyToken(token: string): Promise<VerifyResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(VERIFY_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { valid: false, portalDomain: null, networkError: false }
    const data = await res.json() as { valid: boolean; portalDomain: string }
    return { valid: data.valid, portalDomain: data.portalDomain ?? null, networkError: false }
  } catch {
    clearTimeout(timer)
    return { valid: false, portalDomain: null, networkError: true }
  }
}

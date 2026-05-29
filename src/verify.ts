// src/verify.ts
const VERIFY_URL = 'https://b24mcp-app.bit2beat.com/lite/verify'

export interface VerifyResult {
  valid: boolean
  portalDomain: string | null
}

export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const res = await fetch(VERIFY_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { valid: false, portalDomain: null }
    const data = await res.json() as { valid: boolean; portalDomain: string }
    return { valid: data.valid, portalDomain: data.portalDomain ?? null }
  } catch {
    return { valid: false, portalDomain: null }
  }
}

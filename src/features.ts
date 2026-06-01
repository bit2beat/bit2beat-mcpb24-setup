const FEATURES_URL = 'https://b24-mcp.bit2beat.com/lite/features'

export interface Features {
  automations: boolean
}

export async function getFeatures(token: string): Promise<Features> {
  try {
    const res = await fetch(FEATURES_URL, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { automations: false }
    const data = await res.json() as { features?: Features }
    return { automations: data.features?.automations === true }
  } catch {
    return { automations: false }
  }
}

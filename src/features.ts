const FEATURES_URL = 'https://b24-mcp.bit2beat.com/lite/features'

export interface Features {
  automations: boolean
  catalog: boolean
  skills: Record<string, boolean>
}

export const FALLBACK: Features = {
  automations: false,
  catalog: false,
  skills: { 'portal-scout': false, bizproc: false, 'catalog-importer': false },
}

export async function getFeatures(token: string): Promise<Features> {
  try {
    const res = await fetch(FEATURES_URL, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return FALLBACK
    const data = await res.json() as { features?: { automations?: boolean; catalog?: boolean }; skills?: Record<string, boolean> }
    return {
      automations: data.features?.automations === true,
      catalog: data.features?.catalog === true,
      skills: data.skills ?? FALLBACK.skills,
    }
  } catch {
    return FALLBACK
  }
}

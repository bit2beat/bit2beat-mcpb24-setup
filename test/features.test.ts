import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getFeatures } from '../src/features.js'

describe('getFeatures', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch' as never) })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns features on 200', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ features: { automations: true } }) } as Response)
    const r = await getFeatures('b24lite_x')
    expect(r).toEqual({ automations: true })
  })

  it('returns automations=false on error', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 402 } as Response)
    const r = await getFeatures('b24lite_x')
    expect(r).toEqual({ automations: false })
  })

  it('returns automations=false on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('net'))
    const r = await getFeatures('b24lite_x')
    expect(r).toEqual({ automations: false })
  })
})

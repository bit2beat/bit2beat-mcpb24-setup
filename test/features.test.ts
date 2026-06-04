import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getFeatures, FALLBACK } from '../src/features.js'

describe('getFeatures', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch' as never) })
  afterEach(() => { vi.restoreAllMocks() })

  it('parses full skills map from server response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        features: { automations: true, catalog: false },
        skills: { 'portal-scout': true, bizproc: true, 'catalog-importer': false },
      }),
    } as Response)
    const result = await getFeatures('b24lite_test')
    expect(result.automations).toBe(true)
    expect(result.catalog).toBe(false)
    expect(result.skills['portal-scout']).toBe(true)
    expect(result.skills['bizproc']).toBe(true)
    expect(result.skills['catalog-importer']).toBe(false)
  })

  it('returns FALLBACK when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 402 } as Response)
    const result = await getFeatures('b24lite_bad')
    expect(result).toEqual(FALLBACK)
  })

  it('returns FALLBACK when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('net'))
    const result = await getFeatures('b24lite_throw')
    expect(result).toEqual(FALLBACK)
  })

  it('uses FALLBACK.skills when server omits skills key', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ features: { automations: true, catalog: true } }),
    } as Response)
    const result = await getFeatures('b24lite_noskills')
    expect(result.skills).toEqual(FALLBACK.skills)
  })

  it('returns false for all booleans when server sends empty object', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    const result = await getFeatures('b24lite_empty')
    expect(result.automations).toBe(false)
    expect(result.catalog).toBe(false)
    expect(result.skills).toEqual(FALLBACK.skills)
  })
})

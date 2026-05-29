// test/verify.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyToken } from '../src/verify.js'

describe('verifyToken', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch' as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns valid=true with portalDomain on 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, portalDomain: 'test.bitrix24.com' }),
    } as Response)

    const result = await verifyToken('b24lite_testtoken')

    expect(fetch).toHaveBeenCalledWith(
      'https://b24mcp-app.bit2beat.com/lite/verify',
      expect.objectContaining({
        headers: { Authorization: 'Bearer b24lite_testtoken' },
      }),
    )
    expect(result).toEqual({ valid: true, portalDomain: 'test.bitrix24.com', networkError: false })
  })

  it('returns valid=false networkError=false on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as Response)

    const result = await verifyToken('b24lite_badtoken')

    expect(result).toEqual({ valid: false, portalDomain: null, networkError: false })
  })

  it('returns valid=false networkError=true on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    const result = await verifyToken('b24lite_testtoken')

    expect(result).toEqual({ valid: false, portalDomain: null, networkError: true })
  })
})

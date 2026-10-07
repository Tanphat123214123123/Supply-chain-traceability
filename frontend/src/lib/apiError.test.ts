import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from './apiError'

describe('apiErrorMessage', () => {
  it('translates known server messages', () => {
    const err = { response: { status: 409, data: { error: 'Batch has been recalled — no further events allowed' } } }
    expect(apiErrorMessage(err, 'x')).toMatch(/đã bị thu hồi/)
  })

  it('never leaks an unknown raw server string', () => {
    expect(apiErrorMessage({ response: { status: 500, data: { error: 'Internal server error' } } }, 'Thử lại sau')).toBe('Thử lại sau')
  })

  it('distinguishes a network failure from a server answer', () => {
    expect(apiErrorMessage(new Error('Network Error'), 'x')).toMatch(/Không kết nối/)
  })
})

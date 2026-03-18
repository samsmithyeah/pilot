import { describe, it, expect } from 'vitest'
import { findAvailablePort, serialForPort } from '../emulator.js'

describe('emulator utilities', () => {
  describe('findAvailablePort', () => {
    it('returns base port when no ports are used', () => {
      expect(findAvailablePort(new Set())).toBe(5554)
    })

    it('skips used ports', () => {
      expect(findAvailablePort(new Set([5554]))).toBe(5556)
    })

    it('skips multiple used ports', () => {
      expect(findAvailablePort(new Set([5554, 5556, 5558]))).toBe(5560)
    })

    it('finds first gap in used ports', () => {
      expect(findAvailablePort(new Set([5554, 5558]))).toBe(5556)
    })
  })

  describe('serialForPort', () => {
    it('formats serial from port', () => {
      expect(serialForPort(5554)).toBe('emulator-5554')
      expect(serialForPort(5556)).toBe('emulator-5556')
    })
  })
})

import { describe, expect, it } from 'vitest'
import { canActOn, describeEventData, formatFieldValue, nextStageOf } from './stageFields'

describe('stage fields', () => {
  it('formats option codes, dates and units for people', () => {
    expect(formatFieldValue('PROCESSING', 'method', 'WET')).toBe('Chế biến ướt')
    expect(formatFieldValue('HARVEST', 'harvestDate', '2026-09-30')).toBe('30/09/2026')
    expect(formatFieldValue('DISTRIBUTION', 'temperature', 4)).toBe('4 °C')
  })

  it('keeps only the public facts for the consumer page', () => {
    const rows = describeEventData('DISTRIBUTION', { destination: 'Kho A', vehicle: '51C-123.45' }, { publicOnly: true })
    expect(rows.map((r) => r.key)).toEqual(['destination'])
  })

  it('works out the next stage and whether this person may do it', () => {
    expect(nextStageOf({ currentStage: null })).toBe('HARVEST')
    expect(nextStageOf({ currentStage: 'RETAIL' })).toBeNull()

    const batch = { currentStage: 'PROCESSING' as const, isRecalled: false, assignedToActorId: 'insp-1' }
    expect(canActOn({ id: 'insp-1', role: 'INSPECTOR' }, batch)).toBe(true)
    expect(canActOn({ id: 'insp-2', role: 'INSPECTOR' }, batch)).toBe(false) // handed to someone else
    expect(canActOn({ id: 'p-1', role: 'PROCESSOR' }, batch)).toBe(false) // not their stage
    expect(canActOn({ id: 'a-1', role: 'ADMIN' }, batch)).toBe(true)
    expect(canActOn({ id: 'insp-1', role: 'INSPECTOR' }, { ...batch, isRecalled: true })).toBe(false)
  })
})

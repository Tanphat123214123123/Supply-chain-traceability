import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Timeline from './Timeline'
import { TraceEvent } from '../api/client'

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: 'evt-1',
    batchId: 'batch-1',
    stage: 'HARVEST',
    actorId: 'actor-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    location: 'Đà Lạt',
    data: {},
    hash: 'a'.repeat(64),
    prevHash: '0'.repeat(64),
    sequenceNumber: 0,
    ...overrides,
  }
}

describe('Timeline', () => {
  it('shows an empty state when there are no events', () => {
    render(<Timeline events={[]} />)
    expect(screen.getByText(/Chưa có sự kiện nào/)).toBeInTheDocument()
  })

  it('renders one entry per event, in the order given', () => {
    const events = [makeEvent({ id: 'e1', stage: 'HARVEST' }), makeEvent({ id: 'e2', stage: 'PROCESSING', sequenceNumber: 1 })]
    render(<Timeline events={events} />)
    expect(screen.getByText('Thu hoạch')).toBeInTheDocument()
    expect(screen.getByText('Chế biến')).toBeInTheDocument()
    expect(screen.getByText(/2 khâu/)).toBeInTheDocument()
  })

  it('shows the location and notes for each event', () => {
    render(<Timeline events={[makeEvent({ location: 'Xưởng A', notes: 'kiểm tra kỹ' })]} />)
    expect(screen.getByText(/Xưởng A/)).toBeInTheDocument()
    expect(screen.getByText(/kiểm tra kỹ/)).toBeInTheDocument()
  })
})

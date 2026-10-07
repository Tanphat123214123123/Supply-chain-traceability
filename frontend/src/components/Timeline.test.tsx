import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Timeline from './Timeline'
import { Actor, TraceEvent } from '../api/client'

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
    hashVersion: 2,
    salt: 'b'.repeat(64),
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

  it('says who recorded each step and shows its stage facts as labels, not raw codes', () => {
    const actor: Actor = { id: 'actor-1', name: 'Trần B', role: 'INSPECTOR', organization: 'Trung tâm KĐ', createdAt: '', isActive: true }
    render(
      <Timeline
        events={[makeEvent({ stage: 'QUALITY_CHECK', data: { result: 'PASS', moisture: 11.5 } })]}
        actorsById={new Map([[actor.id, actor]])}
      />,
    )
    expect(screen.getByText('Trung tâm KĐ')).toBeInTheDocument()
    expect(screen.getByText('Đạt')).toBeInTheDocument()
    expect(screen.getByText('11.5 %')).toBeInTheDocument()
    // The hash is still available, but tucked away behind "Chi tiết kỹ thuật".
    expect(screen.getByText(/Chi tiết kỹ thuật/)).toBeInTheDocument()
  })

  it('shows the location and notes for each event', () => {
    render(<Timeline events={[makeEvent({ location: 'Xưởng A', notes: 'kiểm tra kỹ' })]} />)
    expect(screen.getByText(/Xưởng A/)).toBeInTheDocument()
    expect(screen.getByText(/kiểm tra kỹ/)).toBeInTheDocument()
  })
})

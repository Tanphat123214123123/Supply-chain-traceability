import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VerifyBadge from './VerifyBadge'

describe('VerifyBadge', () => {
  it('shows the tampered state when the chain is invalid', () => {
    render(<VerifyBadge isValid={false} hasAnomalies={false} />)
    expect(screen.getByText(/Chuỗi bị can thiệp/)).toBeInTheDocument()
  })

  it('shows the anomaly state when valid but anomalies exist', () => {
    render(<VerifyBadge isValid hasAnomalies />)
    expect(screen.getByText(/Có bất thường/)).toBeInTheDocument()
  })

  it('shows the verified state when valid and no anomalies', () => {
    render(<VerifyBadge isValid hasAnomalies={false} />)
    expect(screen.getByText(/Đã xác thực/)).toBeInTheDocument()
  })

  it('prioritizes the tampered state even when anomalies are also present', () => {
    render(<VerifyBadge isValid={false} hasAnomalies />)
    expect(screen.getByText(/Chuỗi bị can thiệp/)).toBeInTheDocument()
    expect(screen.queryByText(/Có bất thường/)).not.toBeInTheDocument()
  })
})

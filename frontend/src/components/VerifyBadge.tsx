import { ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import Badge from './ui/Badge'

interface Props {
  isValid: boolean
  hasAnomalies: boolean
}

/**
 * What the hash chain can actually prove: that recorded data hasn't been
 * edited or deleted since — not that it was true when entered. The wording
 * stays within that claim.
 */
export default function VerifyBadge({ isValid, hasAnomalies }: Props) {
  if (!isValid) {
    return (
      <Badge tone="danger">
        <ShieldAlert className="w-3.5 h-3.5" /> Chuỗi bị can thiệp
      </Badge>
    )
  }
  if (hasAnomalies) {
    return (
      <Badge tone="warning">
        <TriangleAlert className="w-3.5 h-3.5" /> Có bất thường
      </Badge>
    )
  }
  return (
    <span title="Dữ liệu chưa bị sửa hoặc xoá kể từ khi được ghi">
      <Badge tone="success">
        <ShieldCheck className="w-3.5 h-3.5" /> Dữ liệu nguyên vẹn
      </Badge>
    </span>
  )
}

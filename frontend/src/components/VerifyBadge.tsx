import Badge from './ui/Badge'

interface Props {
  isValid: boolean
  hasAnomalies: boolean
}

export default function VerifyBadge({ isValid, hasAnomalies }: Props) {
  if (!isValid) {
    return <Badge tone="danger">🚨 Chuỗi bị can thiệp</Badge>
  }
  if (hasAnomalies) {
    // Not "⚠ ..." — that glyph renders oversized in some browsers' emoji
    // fallback font and visually bleeds outside this badge's tight line-height.
    return <Badge tone="warning">Có bất thường</Badge>
  }
  return <Badge tone="success">✓ Đã xác thực</Badge>
}

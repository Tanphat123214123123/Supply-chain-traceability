interface Props {
  isValid: boolean
  hasAnomalies: boolean
}

export default function VerifyBadge({ isValid, hasAnomalies }: Props) {
  if (!isValid) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 text-xs
                       font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
        🚨 Chuỗi bị can thiệp
      </span>
    )
  }
  if (hasAnomalies) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs
                       font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
        ⚠ Có bất thường
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-xs
                     font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
      ✓ Đã xác thực
    </span>
  )
}

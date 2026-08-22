import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function useTickerQueryParam(onTicker) {
  const [searchParams] = useSearchParams()
  const requested = (searchParams.get('ticker') || '').trim().toUpperCase()
  const seenRef = useRef('')

  useEffect(() => {
    if (!requested || requested === seenRef.current) return
    seenRef.current = requested
    onTicker(requested)
  }, [onTicker, requested])

  return requested
}

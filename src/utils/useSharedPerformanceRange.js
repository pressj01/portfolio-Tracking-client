import { useEffect, useRef, useState } from 'react'
import {
  nextPerformanceRangeListenerId,
  subscribeSharedPerformanceRange,
  writeSharedPerformanceRange,
} from './performancePeriods'

/**
 * Keeps one performance screen's date range tied to every other one.
 *
 * Replaces the write-only effect each of these screens used to run. The write
 * half is unchanged — the range is still stored so the next screen you open
 * starts where you left off. The new half is adoption: when another mounted
 * screen changes the range, this one follows, which is what makes the two
 * Split View panes answer the same question.
 *
 * `onAdopt` is called with the stored `{ period, start, end }` and is expected
 * to push all three into the caller's own state. It is never called for the
 * screen that made the change, so typing a custom date is not interrupted by
 * the echo of the last complete date.
 */
export default function useSharedPerformanceRange(period, start, end, onAdopt) {
  // Lazy initial state rather than a ref, so the id is assigned once without
  // writing to a ref during render.
  const [listenerId] = useState(nextPerformanceRangeListenerId)

  // Read through refs so a broadcast sees the caller's latest values and latest
  // callback without this hook re-subscribing on every render.
  const adoptRef = useRef(onAdopt)
  const localRef = useRef({ period, start, end })

  useEffect(() => { adoptRef.current = onAdopt })
  useEffect(() => { localRef.current = { period, start, end } }, [period, start, end])

  useEffect(() => {
    writeSharedPerformanceRange(period, start, end, listenerId)
  }, [period, start, end, listenerId])

  useEffect(() => subscribeSharedPerformanceRange({
    id: listenerId,
    onChange: (next) => {
      const local = localRef.current
      if (next.period === local.period && next.start === local.start && next.end === local.end) return
      adoptRef.current?.(next)
    },
  }), [listenerId])
}

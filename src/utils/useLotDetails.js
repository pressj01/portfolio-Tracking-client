import { useCallback, useRef, useState } from 'react'

/**
 * Lot detail behind a ticker row's expander: the ticker's transactions, loaded
 * the first time the row is opened, and which view the panel is showing.
 *
 * `lotDetails` is { [ticker]: { loading, view, transactions?, error? } }; a
 * ticker with no entry is collapsed.
 */
export default function useLotDetails(pf) {
  const [lotDetails, setLotDetails] = useState({})
  // A response is applied only to the request that asked for it. Collapsing a
  // row or switching accounts while its fetch is in flight would otherwise
  // reopen the panel with an answer nobody is waiting for.
  const requestSeq = useRef(0)

  const toggleLotDetails = async ticker => {
    if (lotDetails[ticker]) {
      setLotDetails(current => {
        const next = { ...current }
        delete next[ticker]
        return next
      })
      return
    }
    requestSeq.current += 1
    const requestId = requestSeq.current
    const settle = result => setLotDetails(current => (
      current[ticker]?.requestId === requestId
        ? { ...current, [ticker]: { ...current[ticker], loading: false, ...result } }
        : current
    ))
    setLotDetails(current => ({ ...current, [ticker]: { loading: true, view: 'open', requestId } }))
    try {
      const response = await pf(`/api/holdings/${encodeURIComponent(ticker)}/transactions?include_dividends=true`)
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || `Could not load lot details for ${ticker}`)
      settle({ transactions: data })
    } catch (error) {
      settle({ error: String(error?.message || error) })
    }
  }

  const setLotDetailView = (ticker, view) => {
    setLotDetails(current => (
      current[ticker] ? { ...current, [ticker]: { ...current[ticker], view } } : current
    ))
  }

  const clearLotDetails = useCallback(() => setLotDetails({}), [])

  return { lotDetails, toggleLotDetails, setLotDetailView, clearLotDetails }
}

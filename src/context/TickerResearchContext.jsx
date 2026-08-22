import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import TickerResearchSheet from '../components/TickerResearchSheet'

const TickerResearchContext = createContext(null)

export function useTickerResearch() {
  const context = useContext(TickerResearchContext)
  if (!context) throw new Error('useTickerResearch must be used within TickerResearchProvider')
  return context
}

export default function TickerResearchProvider({ children }) {
  const [ticker, setTicker] = useState(null)
  const [seed, setSeed] = useState(null)

  const openTickerResearch = useCallback((nextTicker, nextSeed = null) => {
    const symbol = String(nextTicker || '').trim().toUpperCase()
    if (!symbol) return
    setSeed(nextSeed || null)
    setTicker(symbol)
  }, [])

  const closeTickerResearch = useCallback(() => {
    setTicker(null)
    setSeed(null)
  }, [])

  const value = useMemo(() => ({ openTickerResearch }), [openTickerResearch])

  return (
    <TickerResearchContext.Provider value={value}>
      {children}
      {ticker && (
        <TickerResearchSheet key={ticker} ticker={ticker} seed={seed} onClose={closeTickerResearch} />
      )}
    </TickerResearchContext.Provider>
  )
}

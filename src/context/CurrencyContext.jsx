import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import { configureMoneyDisplay } from '../utils/money'

const CurrencyContext = createContext(null)

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}

export default function CurrencyProvider({ children }) {
  const [displayCurrency, setDisplayCurrencyState] = useState('USD')
  const [usdToCadRate, setUsdToCadRate] = useState(1)
  const [rateAsOf, setRateAsOf] = useState(null)
  const [rateInfo, setRateInfo] = useState({ source: null, updatedAt: null, stale: false, cached: false, mode: 'live', liveRate: null, manualRate: null })
  const [loading, setLoading] = useState(true)

  const applyDisplay = useCallback((currency, rateData = {}) => {
    const nextCurrency = currency === 'CAD' ? 'CAD' : 'USD'
    const rate = Number(rateData.rate) || 1
    configureMoneyDisplay({ currency: nextCurrency, usdToCadRate: rate })
    setDisplayCurrencyState(nextCurrency)
    setUsdToCadRate(rate)
    setRateAsOf(rateData.asOf || null)
    setRateInfo(rateData.info || { source: null, updatedAt: null, stale: false, cached: false, mode: 'live', liveRate: rate, manualRate: null })
  }, [])

  const requestCadRate = useCallback(async ({ refresh = false, manualRate, saveOverride = false } = {}) => {
    const query = refresh ? '?refresh=1' : ''
    const res = await fetch(`${API_BASE}/api/exchange-rates/usd-cad${query}`, saveOverride ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_rate: manualRate }),
    } : undefined)
    const data = await res.json()
    const rate = Number(data.rate)
    if (!res.ok || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(data.error || 'USD/CAD exchange rate is unavailable.')
    }
    return {
      rate,
      asOf: data.as_of || null,
      info: {
        source: data.source || null,
        updatedAt: data.updated_at || null,
        stale: Boolean(data.stale),
        cached: Boolean(data.cached),
        mode: data.mode === 'manual' ? 'manual' : 'live',
        liveRate: Number.isFinite(Number(data.live_rate)) ? Number(data.live_rate) : null,
        manualRate: Number.isFinite(Number(data.manual_rate)) ? Number(data.manual_rate) : null,
        liveUpdatedAt: data.live_updated_at || null,
        manualUpdatedAt: data.manual_updated_at || null,
        refreshError: data.refresh_error || null,
      },
    }
  }, [])

  const loadCadRate = useCallback(() => requestCadRate(), [requestCadRate])

  useEffect(() => {
    let stale = false
    const load = async () => {
      try {
        const settingsRes = await fetch(`${API_BASE}/api/settings`)
        const settings = await settingsRes.json()
        const currency = settings.display_currency === 'CAD' ? 'CAD' : 'USD'
        const rateData = await loadCadRate()
        if (!stale) applyDisplay(currency, rateData)
      } catch {
        if (!stale) applyDisplay('USD', { rate: 1 })
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [applyDisplay, loadCadRate])

  const setDisplayCurrency = useCallback(async (currency) => {
    const nextCurrency = currency === 'CAD' ? 'CAD' : 'USD'
    const rateData = nextCurrency === 'CAD'
      ? await loadCadRate()
      : { rate: usdToCadRate, asOf: rateAsOf, info: rateInfo }

    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_currency: nextCurrency }),
    })
    if (!res.ok) throw new Error('Failed to save display currency.')

    applyDisplay(nextCurrency, rateData)
  }, [applyDisplay, loadCadRate, rateAsOf, rateInfo, usdToCadRate])

  const refreshCadRate = useCallback(async () => {
    const rateData = await requestCadRate({ refresh: true })
    if (displayCurrency === 'CAD') applyDisplay('CAD', rateData)
    else {
      setRateAsOf(rateData.asOf)
      setRateInfo(rateData.info)
    }
    return rateData
  }, [applyDisplay, displayCurrency, requestCadRate])

  const setCadManualRate = useCallback(async (manualRate) => {
    const rateData = await requestCadRate({ manualRate, saveOverride: true })
    if (displayCurrency === 'CAD') applyDisplay('CAD', rateData)
    else {
      setRateAsOf(rateData.asOf)
      setRateInfo(rateData.info)
    }
    return rateData
  }, [applyDisplay, displayCurrency, requestCadRate])

  const value = useMemo(() => ({
    displayCurrency,
    usdToCadRate,
    rateAsOf,
    rateInfo,
    loading,
    setDisplayCurrency,
    refreshCadRate,
    setCadManualRate,
  }), [displayCurrency, usdToCadRate, rateAsOf, rateInfo, loading, setDisplayCurrency, refreshCadRate, setCadManualRate])

  return (
    <CurrencyContext.Provider value={value}>
      {loading
        ? <div className="ac-loading"><span className="spinner" /> Loading...</div>
        : <div key={`${displayCurrency}:${usdToCadRate}`} style={{ display: 'contents' }}>{children}</div>}
    </CurrencyContext.Provider>
  )
}

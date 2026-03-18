import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { API_BASE } from '../config'
import Plot from 'react-plotly.js'

// ── Indicator helpers ────────────────────────────────────────────────────────

function sma(values, period) {
  // Warm-up mode: start plotting from bar 0 using available data
  const result = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    const window = Math.min(period, i + 1)
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += values[j]
    result[i] = sum / window
  }
  return result
}

function ema(values, period) {
  const result = new Array(values.length).fill(null)
  if (!values.length) return result
  const k = 2 / (period + 1)
  // Seed with first value so EMA starts from bar 0
  let prev = values[0]
  result[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    result[i] = prev
  }
  return result
}

// ── Study Templates (TOS-style: add multiple instances of the same type) ─────

const MA_COLORS = ['#FF6B35', '#2EC4B6', '#E71D36', '#FFD700', '#9B59B6', '#00BCD4', '#FF9800', '#4CAF50']

const STUDY_TEMPLATES = [
  {
    type: 'atr', label: 'Average True Range', group: 'Volatility', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const period = params.period
      const tr = records.map((r, i) => {
        const prevClose = i > 0 ? records[i - 1].close : r.close
        return Math.max(r.high - r.low, Math.abs(r.high - prevClose), Math.abs(r.low - prevClose))
      })
      const atr = new Array(records.length).fill(null)
      if (tr.length === 0) return { mainTraces: [], subTraces: [], subTitle: '' }
      atr[0] = tr[0]
      const k = 1 / period
      for (let i = 1; i < tr.length; i++) {
        atr[i] = tr[i] * k + atr[i - 1] * (1 - k)
      }
      return {
        mainTraces: [],
        subTraces: [{ x: dates, y: atr, type: 'scatter', mode: 'lines', name: `ATR ${period}`, line: { color: '#FF9800', width: 1.5 }, showlegend: false }],
        subTitle: `ATR (${period})`,
      }
    },
  },
  {
    type: 'bb', label: 'Bollinger Bands', group: 'Volatility', panel: 'price',
    multi: false, defaultParams: { period: 20, stdDev: 2 },
    paramFields: [
      { key: 'period', label: 'Period', type: 'number', min: 1, max: 200 },
      { key: 'stdDev', label: 'Std Dev', type: 'number', min: 0.5, max: 5 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const { period, stdDev } = params
      const mid = sma(closes, period)
      const upper = new Array(closes.length).fill(null)
      const lower = new Array(closes.length).fill(null)
      for (let i = 0; i < closes.length; i++) {
        if (mid[i] == null) continue
        const w = Math.min(period, i + 1)
        let sumSq = 0
        for (let j = i - w + 1; j <= i; j++) sumSq += (closes[j] - mid[i]) ** 2
        const sd = Math.sqrt(sumSq / w)
        upper[i] = mid[i] + stdDev * sd
        lower[i] = mid[i] - stdDev * sd
      }
      return {
        mainTraces: [
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: `BB Upper`, line: { color: '#7986CB', width: 1, dash: 'dash' }, showlegend: false },
          { x: dates, y: mid, type: 'scatter', mode: 'lines', name: `BB Mid (${period})`, line: { color: '#7986CB', width: 1 } },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: `BB Lower`, line: { color: '#7986CB', width: 1, dash: 'dash' }, showlegend: false, fill: 'tonexty', fillcolor: 'rgba(121,134,203,0.1)' },
        ],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'ao', label: 'Awesome Oscillator', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: {}, paramFields: [],
    compute(records) {
      const dates = records.map(r => r.date)
      const midpoints = records.map(r => (r.high + r.low) / 2)
      const sma5 = sma(midpoints, 5)
      const sma34 = sma(midpoints, 34)
      const ao = midpoints.map((_, i) => sma5[i] - sma34[i])
      const colors = ao.map((v, i) => {
        if (v == null) return '#999'
        const prev = i > 0 ? ao[i - 1] : null
        if (prev == null) return v >= 0 ? '#26A69A' : '#EF5350'
        return v >= prev ? '#26A69A' : '#EF5350'
      })
      return {
        mainTraces: [],
        subTraces: [{ x: dates, y: ao, type: 'bar', name: 'AO', marker: { color: colors }, showlegend: false }],
        subTitle: 'Awesome Oscillator',
      }
    },
  },
  {
    type: 'dss', label: 'BressertDSS', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { stochLen: 13, emaLen: 8 },
    paramFields: [
      { key: 'stochLen', label: 'Stoch Length', type: 'number', min: 1, max: 100 },
      { key: 'emaLen', label: 'EMA Length', type: 'number', min: 1, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const { stochLen, emaLen } = params

      // Helper: rolling highest/lowest of an array
      const rolling = (arr, len, fn) => {
        const out = new Array(arr.length).fill(null)
        for (let i = 0; i < arr.length; i++) {
          const w = Math.min(len, i + 1)
          let val = arr[i]
          for (let j = i - w + 1; j < i; j++) if (arr[j] != null) val = fn(val, arr[j])
          out[i] = val
        }
        return out
      }
      const hh = rolling(highs, stochLen, Math.max)
      const ll = rolling(lows, stochLen, Math.min)

      // Step 1: Raw stochastic
      const k1 = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        const range = hh[i] - ll[i]
        k1[i] = range > 0 ? (closes[i] - ll[i]) / range * 100 : 0
      }
      // Step 2: EMA of K1
      const emaK1 = ema(k1, emaLen)

      // Step 3: Stochastic of EMA K1
      const hhEma = rolling(emaK1, stochLen, Math.max)
      const llEma = rolling(emaK1, stochLen, Math.min)
      const k2 = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        if (emaK1[i] == null) continue
        const range = hhEma[i] - llEma[i]
        k2[i] = range > 0 ? (emaK1[i] - llEma[i]) / range * 100 : 0
      }
      // Step 4: EMA of K2 = DSS
      const dss = ema(k2.map(v => v ?? 0), emaLen)

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: dss, type: 'scatter', mode: 'lines', name: `DSS (${stochLen},${emaLen})`, line: { color: '#E040FB', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [80, 80], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [20, 20], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `BressertDSS (${stochLen},${emaLen})`,
      }
    },
  },
  {
    type: 'cmf', label: 'Chaikin Money Flow', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 20 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const period = params.period
      const mfm = records.map(r => {
        const hl = r.high - r.low
        return hl > 0 ? ((r.close - r.low) - (r.high - r.close)) / hl : 0
      })
      const mfv = records.map((r, i) => mfm[i] * (r.volume || 0))
      const cmf = new Array(records.length).fill(null)
      for (let i = 0; i < records.length; i++) {
        const window = Math.min(period, i + 1)
        let sumMfv = 0, sumVol = 0
        for (let j = i - window + 1; j <= i; j++) {
          sumMfv += mfv[j]
          sumVol += (records[j].volume || 0)
        }
        cmf[i] = sumVol > 0 ? sumMfv / sumVol : 0
      }
      const colors = cmf.map(v => v != null && v >= 0 ? '#26A69A' : '#EF5350')
      return {
        mainTraces: [],
        subTraces: [{ x: dates, y: cmf, type: 'bar', name: 'CMF', marker: { color: colors }, showlegend: false }],
        subTitle: `Chaikin Money Flow (${period})`,
      }
    },
  },
  {
    type: 'chaikin_osc', label: 'Chaikin Oscillator', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { fast: 3, slow: 10 },
    paramFields: [
      { key: 'fast', label: 'Fast', type: 'number', min: 1, max: 50 },
      { key: 'slow', label: 'Slow', type: 'number', min: 1, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const adl = new Array(records.length).fill(0)
      let cumAD = 0
      for (let i = 0; i < records.length; i++) {
        const r = records[i]
        const hl = r.high - r.low
        const mfm = hl > 0 ? ((r.close - r.low) - (r.high - r.close)) / hl : 0
        cumAD += mfm * (r.volume || 0)
        adl[i] = cumAD
      }
      const emaFast = ema(adl, params.fast)
      const emaSlow = ema(adl, params.slow)
      const osc = adl.map((_, i) => emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)
      const colors = osc.map(v => v != null && v >= 0 ? '#26A69A' : '#EF5350')
      return {
        mainTraces: [],
        subTraces: [{ x: dates, y: osc, type: 'bar', name: 'Chaikin Osc', marker: { color: colors }, showlegend: false }],
        subTitle: `Chaikin Oscillator (${params.fast},${params.slow})`,
      }
    },
  },
  {
    type: 'chop', label: 'Choppiness Index', group: 'Volatility', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const period = params.period
      const tr = records.map((r, i) => {
        const prevClose = i > 0 ? records[i - 1].close : r.close
        return Math.max(r.high - r.low, Math.abs(r.high - prevClose), Math.abs(r.low - prevClose))
      })
      const chop = new Array(records.length).fill(null)
      for (let i = 0; i < records.length; i++) {
        const lookback = Math.min(period, i + 1)
        const log10Lb = Math.log10(lookback)
        let sumTR = 0, hh = -Infinity, ll = Infinity
        for (let j = i - lookback + 1; j <= i; j++) {
          sumTR += tr[j]
          if (records[j].high > hh) hh = records[j].high
          if (records[j].low < ll) ll = records[j].low
        }
        const range = hh - ll
        chop[i] = range > 0 ? 100 * Math.log10(sumTR / range) / log10Lb : 50
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: chop, type: 'scatter', mode: 'lines', name: `CHOP ${period}`, line: { color: '#29B6F6', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [61.8, 61.8], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [38.2, 38.2], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `Choppiness Index (${period})`,
      }
    },
  },
  {
    type: 'ehlers_2pbf', label: 'Ehlers2PoleButterworthFilter', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 200 }],
    compute(records, params, color) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      const a = Math.exp(-Math.sqrt(2) * Math.PI / period)
      const b = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / period)
      const c2 = b
      const c3 = -(a * a)
      const c1 = 1 - c2 - c3
      const filt = new Array(n).fill(null)
      if (n > 0) filt[0] = closes[0]
      if (n > 1) filt[1] = closes[1]
      for (let i = 2; i < n; i++) {
        filt[i] = c1 * (closes[i] + closes[i - 1]) / 2 + c2 * filt[i - 1] + c3 * filt[i - 2]
      }
      return {
        mainTraces: [{ x: dates, y: filt, type: 'scatter', mode: 'lines', name: `E2PBF ${period}`, line: { width: 1.5, color: color || '#00E5FF' } }],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'ehlers_ac', label: 'EhlersAutoCorrelation', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { lag: 10, hpPeriod: 48, window: 48 },
    paramFields: [
      { key: 'lag', label: 'Lag', type: 'number', min: 1, max: 100 },
      { key: 'hpPeriod', label: 'HP Period', type: 'number', min: 5, max: 200 },
      { key: 'window', label: 'Window', type: 'number', min: 10, max: 200 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { lag, hpPeriod, window } = params
      // Ehlers high-pass filter (detrend)
      const alpha1 = (Math.cos(0.707 * 2 * Math.PI / hpPeriod) + Math.sin(0.707 * 2 * Math.PI / hpPeriod) - 1) / Math.cos(0.707 * 2 * Math.PI / hpPeriod)
      const hp = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        hp[i] = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (closes[i] - 2 * closes[i - 1] + closes[i - 2]) + 2 * (1 - alpha1) * hp[i - 1] - (1 - alpha1) * (1 - alpha1) * hp[i - 2]
      }
      // Super smoother
      const ssP = 10
      const a = Math.exp(-Math.sqrt(2) * Math.PI / ssP)
      const b2 = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / ssP)
      const c3 = -(a * a)
      const c1 = 1 - b2 - c3
      const filt = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        filt[i] = c1 * (hp[i] + hp[i - 1]) / 2 + b2 * filt[i - 1] + c3 * filt[i - 2]
      }
      // Autocorrelation at specified lag — progressive window from bar 0
      const ac = new Array(n).fill(null)
      for (let i = lag; i < n; i++) {
        const w = Math.min(window, i - lag + 1)
        if (w < 2) { ac[i] = 0; continue }
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0
        for (let j = 0; j < w; j++) {
          const x = filt[i - j]
          const y = filt[i - j - lag]
          sumXY += x * y
          sumX += x
          sumY += y
          sumX2 += x * x
          sumY2 += y * y
        }
        const denom = Math.sqrt((sumX2 - sumX * sumX / w) * (sumY2 - sumY * sumY / w))
        ac[i] = denom > 0 ? (sumXY - sumX * sumY / w) / denom : 0
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: ac, type: 'scatter', mode: 'lines', name: `AC (${lag})`, line: { color: '#76FF03', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [0.5, 0.5], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [-0.5, -0.5], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', line: { color: '#555', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `EhlersAutoCorrelation (${lag},${hpPeriod},${window})`,
      }
    },
  },
  {
    type: 'ehlers_acp', label: 'EhlersAutoCorrelationPeriodogram', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { minPeriod: 8, maxPeriod: 48, hpPeriod: 48 },
    paramFields: [
      { key: 'minPeriod', label: 'Min Period', type: 'number', min: 2, max: 50 },
      { key: 'maxPeriod', label: 'Max Period', type: 'number', min: 10, max: 100 },
      { key: 'hpPeriod', label: 'HP Period', type: 'number', min: 5, max: 200 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { minPeriod, maxPeriod, hpPeriod } = params

      // Ehlers high-pass filter
      const alpha1 = (Math.cos(0.707 * 2 * Math.PI / hpPeriod) + Math.sin(0.707 * 2 * Math.PI / hpPeriod) - 1) / Math.cos(0.707 * 2 * Math.PI / hpPeriod)
      const hp = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        hp[i] = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (closes[i] - 2 * closes[i - 1] + closes[i - 2]) + 2 * (1 - alpha1) * hp[i - 1] - (1 - alpha1) * (1 - alpha1) * hp[i - 2]
      }
      // Super smoother
      const ssP = 10
      const a = Math.exp(-Math.sqrt(2) * Math.PI / ssP)
      const b2 = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / ssP)
      const c3ss = -(a * a)
      const c1ss = 1 - b2 - c3ss
      const filt = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        filt[i] = c1ss * (hp[i] + hp[i - 1]) / 2 + b2 * filt[i - 1] + c3ss * filt[i - 2]
      }

      // Dominant cycle via autocorrelation periodogram — progressive from bar 0
      const domCycle = new Array(n).fill(null)

      for (let i = 2; i < n; i++) {
        // Determine which candidate periods fit: we need i - (avgLen-1) - p >= 0
        const usableMax = Math.min(maxPeriod, i)
        if (usableMax < minPeriod) {
          domCycle[i] = minPeriod
          continue
        }
        const corrs = []
        for (let p = minPeriod; p <= usableMax; p++) {
          // max avgLen so that filt[i - j - p] stays >= 0: i - (avgLen-1) - p >= 0 => avgLen <= i - p + 1
          const avgLen = Math.min(maxPeriod, i - p + 1)
          if (avgLen < 2) continue
          let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0
          for (let j = 0; j < avgLen; j++) {
            const x = filt[i - j]
            const y = filt[i - j - p]
            sumXY += x * y
            sumX += x
            sumY += y
            sumX2 += x * x
            sumY2 += y * y
          }
          const denom = Math.sqrt((sumX2 - sumX * sumX / avgLen) * (sumY2 - sumY * sumY / avgLen))
          const r = denom > 0 ? (sumXY - sumX * sumY / avgLen) / denom : 0
          corrs.push({ period: p, r: Math.max(r, 0) })
        }
        if (corrs.length === 0) {
          domCycle[i] = minPeriod
          continue
        }
        let num = 0, den = 0
        for (const c of corrs) {
          const w = c.r * c.r
          num += c.period * w
          den += w
        }
        domCycle[i] = den > 0 ? num / den : (minPeriod + usableMax) / 2
      }

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: domCycle, type: 'scatter', mode: 'lines', name: 'Dominant Cycle', line: { color: '#FFD740', width: 1.5 }, showlegend: false },
        ],
        subTitle: `EhlersACPeriodogram (${minPeriod}-${maxPeriod})`,
      }
    },
  },
  {
    type: 'ehlers_hp', label: 'EhlersHighpassFilter', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 48 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 5, max: 200 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      const alpha1 = (Math.cos(0.707 * 2 * Math.PI / period) + Math.sin(0.707 * 2 * Math.PI / period) - 1) / Math.cos(0.707 * 2 * Math.PI / period)
      const hp = new Array(n).fill(null)
      if (n > 0) hp[0] = 0
      if (n > 1) hp[1] = 0
      for (let i = 2; i < n; i++) {
        hp[i] = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (closes[i] - 2 * closes[i - 1] + closes[i - 2]) + 2 * (1 - alpha1) * hp[i - 1] - (1 - alpha1) * (1 - alpha1) * hp[i - 2]
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: hp, type: 'scatter', mode: 'lines', name: `HP (${period})`, line: { color: '#FF4081', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', line: { color: '#555', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `EhlersHighpassFilter (${period})`,
      }
    },
  },
  {
    type: 'ehlers_stoch', label: 'EhlersStochastic', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      // Ehlers 2-pole Butterworth filter (super smoother)
      const a = Math.exp(-Math.sqrt(2) * Math.PI / period)
      const b = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / period)
      const c2 = b
      const c3 = -(a * a)
      const c1 = 1 - c2 - c3
      // Apply super smoother to close
      const filt = new Array(n).fill(0)
      filt[0] = closes[0]
      if (n > 1) filt[1] = closes[1]
      for (let i = 2; i < n; i++) {
        filt[i] = c1 * (closes[i] + closes[i - 1]) / 2 + c2 * filt[i - 1] + c3 * filt[i - 2]
      }
      // Stochastic of the filtered data
      const stoch = new Array(n).fill(null)
      for (let i = period - 1; i < n; i++) {
        let hh = -Infinity, ll = Infinity
        for (let j = i - period + 1; j <= i; j++) {
          if (filt[j] > hh) hh = filt[j]
          if (filt[j] < ll) ll = filt[j]
        }
        const range = hh - ll
        stoch[i] = range > 0 ? (filt[i] - ll) / range * 100 : 50
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: stoch, type: 'scatter', mode: 'lines', name: `Ehlers Stoch (${period})`, line: { color: '#00E5FF', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [80, 80], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [20, 20], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `EhlersStochastic (${period})`,
      }
    },
  },
  {
    type: 'ehlers_ssf', label: 'EhlersSuperSmoothFilter', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 20 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 200 }],
    compute(records, params, color) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      const a = Math.exp(-Math.sqrt(2) * Math.PI / period)
      const b = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / period)
      const c2 = b
      const c3 = -(a * a)
      const c1 = 1 - c2 - c3
      const filt = new Array(n).fill(null)
      if (n > 0) filt[0] = closes[0]
      if (n > 1) filt[1] = closes[1]
      for (let i = 2; i < n; i++) {
        filt[i] = c1 * (closes[i] + closes[i - 1]) / 2 + c2 * filt[i - 1] + c3 * filt[i - 2]
      }
      return {
        mainTraces: [{ x: dates, y: filt, type: 'scatter', mode: 'lines', name: `SSF ${period}`, line: { width: 1.5, color: color || '#18FFFF' } }],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'elder_impulse', label: 'EldersImpulseSystem', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { emaPeriod: 13, macdFast: 12, macdSlow: 26, macdSignal: 9 },
    paramFields: [
      { key: 'emaPeriod', label: 'EMA', type: 'number', min: 1, max: 100 },
      { key: 'macdFast', label: 'MACD Fast', type: 'number', min: 1, max: 100 },
      { key: 'macdSlow', label: 'MACD Slow', type: 'number', min: 1, max: 100 },
      { key: 'macdSignal', label: 'Signal', type: 'number', min: 1, max: 100 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const { emaPeriod, macdFast, macdSlow, macdSignal } = params
      // EMA of close
      const emaLine = ema(closes, emaPeriod)
      // MACD histogram
      const emaF = ema(closes, macdFast)
      const emaS = ema(closes, macdSlow)
      const macdLine = closes.map((_, i) => emaF[i] != null && emaS[i] != null ? emaF[i] - emaS[i] : 0)
      const sigLine = ema(macdLine, macdSignal)
      const hist = macdLine.map((v, i) => sigLine[i] != null ? v - sigLine[i] : 0)
      // Impulse: +1 green, -1 red, 0 neutral
      const impulse = new Array(closes.length).fill(0)
      const colors = new Array(closes.length).fill('#2196F3')
      for (let i = 1; i < closes.length; i++) {
        const emaRising = emaLine[i] != null && emaLine[i - 1] != null && emaLine[i] > emaLine[i - 1]
        const emaFalling = emaLine[i] != null && emaLine[i - 1] != null && emaLine[i] < emaLine[i - 1]
        const histRising = hist[i] > hist[i - 1]
        const histFalling = hist[i] < hist[i - 1]
        if (emaRising && histRising) {
          impulse[i] = 1
          colors[i] = '#26A69A'
        } else if (emaFalling && histFalling) {
          impulse[i] = -1
          colors[i] = '#EF5350'
        } else {
          impulse[i] = 0
          colors[i] = '#2196F3'
        }
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: impulse, type: 'bar', name: 'Impulse', marker: { color: colors }, showlegend: false },
        ],
        subTitle: `Elder Impulse (${emaPeriod},${macdFast},${macdSlow},${macdSignal})`,
      }
    },
  },
  {
    type: 'elliott_osc', label: 'Elliott Wave Oscillator', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { fast: 5, slow: 34 },
    paramFields: [
      { key: 'fast', label: 'Fast', type: 'number', min: 1, max: 50 },
      { key: 'slow', label: 'Slow', type: 'number', min: 1, max: 100 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const smaFast = sma(closes, params.fast)
      const smaSlow = sma(closes, params.slow)
      const osc = closes.map((_, i) => smaFast[i] - smaSlow[i])
      const colors = osc.map((v, i) => {
        if (v == null) return '#999'
        const prev = i > 0 ? osc[i - 1] : null
        if (prev == null) return v >= 0 ? '#26A69A' : '#EF5350'
        return v >= prev ? '#26A69A' : '#EF5350'
      })
      return {
        mainTraces: [],
        subTraces: [{ x: dates, y: osc, type: 'bar', name: 'EWO', marker: { color: colors }, showlegend: false }],
        subTitle: `Elliott Wave Osc (${params.fast},${params.slow})`,
      }
    },
  },
  {
    type: 'ema', label: 'ExpMovingAvg', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 20 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 500 }],
    compute(records, params, color) {
      const vals = ema(records.map(r => r.close), params.period)
      return {
        mainTraces: [{ x: records.map(r => r.date), y: vals, type: 'scatter', mode: 'lines', name: `EMA ${params.period}`, line: { width: 1.5, color: color || '#2EC4B6' } }],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'fir_hamming', label: 'FIR_Hamming', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 20 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 3, max: 200 }],
    compute(records, params, color) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      // Build Hamming window coefficients
      const coeffs = []
      let sum = 0
      for (let k = 0; k < period; k++) {
        const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * k / (period - 1))
        coeffs.push(w)
        sum += w
      }
      // Normalize
      for (let k = 0; k < period; k++) coeffs[k] /= sum
      // Apply FIR filter with warm-up
      const filt = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        const w = Math.min(period, i + 1)
        let val = 0, wSum = 0
        for (let j = 0; j < w; j++) {
          val += closes[i - j] * coeffs[j]
          wSum += coeffs[j]
        }
        filt[i] = val / wSum
      }
      return {
        mainTraces: [{ x: dates, y: filt, type: 'scatter', mode: 'lines', name: `Hamming ${period}`, line: { width: 1.5, color: color || '#F06292' } }],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'fm_demod', label: 'FM_Demodulator', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { hpPeriod: 48, ssPeriod: 10 },
    paramFields: [
      { key: 'hpPeriod', label: 'HP Period', type: 'number', min: 5, max: 200 },
      { key: 'ssPeriod', label: 'SS Period', type: 'number', min: 2, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { hpPeriod, ssPeriod } = params
      // High-pass filter
      const alpha1 = (Math.cos(0.707 * 2 * Math.PI / hpPeriod) + Math.sin(0.707 * 2 * Math.PI / hpPeriod) - 1) / Math.cos(0.707 * 2 * Math.PI / hpPeriod)
      const hp = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        hp[i] = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (closes[i] - 2 * closes[i - 1] + closes[i - 2]) + 2 * (1 - alpha1) * hp[i - 1] - (1 - alpha1) * (1 - alpha1) * hp[i - 2]
      }
      // Super smoother
      const a = Math.exp(-Math.sqrt(2) * Math.PI / ssPeriod)
      const b2 = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / ssPeriod)
      const c3 = -(a * a)
      const c1 = 1 - b2 - c3
      const filt = new Array(n).fill(0)
      for (let i = 2; i < n; i++) {
        filt[i] = c1 * (hp[i] + hp[i - 1]) / 2 + b2 * filt[i - 1] + c3 * filt[i - 2]
      }
      // Hilbert transform approximation for I and Q
      const inPhase = new Array(n).fill(0)
      const quad = new Array(n).fill(0)
      for (let i = 7; i < n; i++) {
        // Compute quadrature using Hilbert FIR coefficients
        quad[i] = (filt[i] - filt[i - 6]) * (0.707 + 0.007 * (filt[i] - filt[i - 6]))
        inPhase[i] = filt[i - 3]
      }
      // Smooth I and Q
      const smoothI = new Array(n).fill(0)
      const smoothQ = new Array(n).fill(0)
      for (let i = 1; i < n; i++) {
        smoothI[i] = 0.15 * inPhase[i] + 0.85 * smoothI[i - 1]
        smoothQ[i] = 0.15 * quad[i] + 0.85 * smoothQ[i - 1]
      }
      // Phase angle and FM demodulation (delta phase)
      const fm = new Array(n).fill(null)
      let prevPhase = 0
      for (let i = 7; i < n; i++) {
        let phase = 0
        if (Math.abs(smoothI[i]) > 0.001) {
          phase = Math.atan2(smoothQ[i], smoothI[i]) * 180 / Math.PI
        }
        // Unwrap phase and compute delta
        let delta = phase - prevPhase
        if (delta < -180) delta += 360
        if (delta > 180) delta -= 360
        fm[i] = delta
        prevPhase = phase
      }
      // Smooth the output
      const smoothFm = new Array(n).fill(null)
      for (let i = 8; i < n; i++) {
        smoothFm[i] = fm[i] != null && fm[i - 1] != null ? 0.2 * fm[i] + 0.8 * (smoothFm[i - 1] || 0) : null
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: smoothFm, type: 'scatter', mode: 'lines', name: 'FM Demod', line: { color: '#EA80FC', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', line: { color: '#555', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `FM Demodulator (${hpPeriod},${ssPeriod})`,
      }
    },
  },
  {
    type: 'force_index', label: 'ForceIndex', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 13 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const n = records.length
      // Raw Force Index = (Close - PrevClose) * Volume
      const rawFI = new Array(n).fill(0)
      for (let i = 1; i < n; i++) {
        rawFI[i] = (records[i].close - records[i - 1].close) * (records[i].volume || 0)
      }
      // Smooth with EMA
      const fi = ema(rawFI, params.period)
      const colors = fi.map(v => v != null && v >= 0 ? '#26A69A' : '#EF5350')
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: fi, type: 'bar', name: `Force (${params.period})`, marker: { color: colors }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', line: { color: '#555', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `ForceIndex (${params.period})`,
      }
    },
  },
  {
    type: 'fw_dpo_mobo', label: 'FW_DPO_MOBO', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { dpoPeriod: 20, moboLength: 10, numDevs: 0.8 },
    paramFields: [
      { key: 'dpoPeriod', label: 'DPO Period', type: 'number', min: 2, max: 100 },
      { key: 'moboLength', label: 'MOBO Length', type: 'number', min: 2, max: 100 },
      { key: 'numDevs', label: 'Num Devs', type: 'number', min: 0.1, max: 5 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { dpoPeriod, moboLength, numDevs } = params
      // DPO = Close - SMA(dpoPeriod) shifted back by dpoPeriod/2 + 1
      const smaVals = sma(closes, dpoPeriod)
      const shift = Math.floor(dpoPeriod / 2) + 1
      const dpo = new Array(n).fill(null)
      for (let i = shift; i < n; i++) {
        if (smaVals[i - shift] != null) dpo[i] = closes[i] - smaVals[i - shift]
      }
      // MOBO bands: SMA and StdDev of DPO over moboLength
      const upper = new Array(n).fill(null)
      const lower = new Array(n).fill(null)
      const mid = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        if (dpo[i] == null) continue
        const w = Math.min(moboLength, i + 1)
        let sum = 0, cnt = 0
        for (let j = i - w + 1; j <= i; j++) {
          if (dpo[j] != null) { sum += dpo[j]; cnt++ }
        }
        if (cnt === 0) continue
        const avg = sum / cnt
        let sumSq = 0
        for (let j = i - w + 1; j <= i; j++) {
          if (dpo[j] != null) sumSq += (dpo[j] - avg) ** 2
        }
        const sd = Math.sqrt(sumSq / cnt)
        mid[i] = avg
        upper[i] = avg + numDevs * sd
        lower[i] = avg - numDevs * sd
      }
      // Color DPO bars: green above upper, red below lower, blue in between
      const colors = dpo.map((v, i) => {
        if (v == null) return '#999'
        if (upper[i] != null && v > upper[i]) return '#26A69A'
        if (lower[i] != null && v < lower[i]) return '#EF5350'
        return '#2196F3'
      })
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: dpo, type: 'bar', name: 'DPO', marker: { color: colors }, showlegend: false },
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: 'MOBO Upper', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: 'MOBO Lower', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false },
        ],
        subTitle: `DPO MOBO (${dpoPeriod},${moboLength},${numDevs})`,
      }
    },
  },
  {
    type: 'fw_fisher', label: 'FW_FisherTransform', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 10 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 2, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      // Normalize close to -1..1 range over lookback period
      const norm = new Array(n).fill(0)
      let prevNorm = 0
      for (let i = 0; i < n; i++) {
        const w = Math.min(period, i + 1)
        let hh = -Infinity, ll = Infinity
        for (let j = i - w + 1; j <= i; j++) {
          if (closes[j] > hh) hh = closes[j]
          if (closes[j] < ll) ll = closes[j]
        }
        const range = hh - ll
        let val = range > 0 ? 2 * ((closes[i] - ll) / range - 0.5) : 0
        // Smooth
        val = 0.33 * val + 0.67 * prevNorm
        // Clamp to avoid infinity in log
        if (val > 0.99) val = 0.99
        if (val < -0.99) val = -0.99
        norm[i] = val
        prevNorm = val
      }
      // Fisher Transform: 0.5 * ln((1+x)/(1-x))
      const fisher = new Array(n).fill(null)
      const signal = new Array(n).fill(null)
      let prevFisher = 0
      for (let i = 0; i < n; i++) {
        const ft = 0.5 * Math.log((1 + norm[i]) / (1 - norm[i])) + 0.5 * prevFisher
        fisher[i] = ft
        signal[i] = prevFisher
        prevFisher = ft
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: fisher, type: 'scatter', mode: 'lines', name: 'Fisher', line: { color: '#00E676', width: 1.5 }, showlegend: false },
          { x: dates, y: signal, type: 'scatter', mode: 'lines', name: 'Signal', line: { color: '#FF5252', width: 1.5, dash: 'dash' }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [0, 0], type: 'scatter', mode: 'lines', line: { color: '#555', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `FW_FisherTransform (${period})`,
      }
    },
  },
  {
    type: 'hist_vol', label: 'HistoricalVolatility', group: 'Volatility', panel: 'lower',
    multi: false, defaultParams: { period: 20, annualize: 252 },
    paramFields: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 200 },
      { key: 'annualize', label: 'Trading Days', type: 'number', min: 1, max: 365 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { period, annualize } = params
      // Log returns
      const logRet = new Array(n).fill(0)
      for (let i = 1; i < n; i++) {
        logRet[i] = closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0
      }
      // Rolling std dev of log returns, annualized, as percentage
      const hv = new Array(n).fill(null)
      for (let i = period; i < n; i++) {
        let sum = 0, sumSq = 0
        for (let j = i - period + 1; j <= i; j++) {
          sum += logRet[j]
          sumSq += logRet[j] * logRet[j]
        }
        const mean = sum / period
        const variance = sumSq / period - mean * mean
        hv[i] = Math.sqrt(Math.max(0, variance) * annualize) * 100
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: hv, type: 'scatter', mode: 'lines', name: `HV ${period}`, line: { color: '#FF6E40', width: 1.5 }, showlegend: false },
        ],
        subTitle: `Historical Volatility (${period}d, ${annualize}d ann.)`,
      }
    },
  },
  {
    type: 'hma', label: 'HullMovingAvg', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 20 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 2, max: 500 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const period = params.period
      // WMA helper (weighted moving average)
      const wma = (arr, len) => {
        const out = new Array(arr.length).fill(null)
        for (let i = 0; i < arr.length; i++) {
          const w = Math.min(len, i + 1)
          let sum = 0, wSum = 0
          for (let j = 0; j < w; j++) {
            const weight = w - j
            sum += arr[i - j] * weight
            wSum += weight
          }
          out[i] = sum / wSum
        }
        return out
      }
      // HMA = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
      const halfLen = Math.max(1, Math.floor(period / 2))
      const sqrtLen = Math.max(1, Math.round(Math.sqrt(period)))
      const wmaHalf = wma(closes, halfLen)
      const wmaFull = wma(closes, period)
      const diff = closes.map((_, i) => wmaHalf[i] != null && wmaFull[i] != null ? 2 * wmaHalf[i] - wmaFull[i] : closes[i])
      const hull = wma(diff, sqrtLen)

      // Split into colored segments: green when rising, red when falling
      const traces = []
      let segStart = 0
      for (let i = 1; i <= n; i++) {
        const prevRising = i > 1 && hull[i - 1] != null && hull[i - 2] != null ? hull[i - 1] >= hull[i - 2] : true
        const currRising = i < n && hull[i] != null && hull[i - 1] != null ? hull[i] >= hull[i - 1] : prevRising
        if (currRising !== prevRising || i === n) {
          // Close out segment
          const end = Math.min(i, n - 1)
          const segDates = dates.slice(segStart, end + 1)
          const segVals = hull.slice(segStart, end + 1)
          const color = prevRising ? '#26A69A' : '#EF5350'
          traces.push({
            x: segDates, y: segVals, type: 'scatter', mode: 'lines',
            name: `HMA ${period}`,
            line: { width: 2, color },
            showlegend: traces.length === 0,
            legendgroup: `hma_${period}`,
          })
          segStart = i - 1 // overlap by 1 for continuity
        }
      }
      return { mainTraces: traces, subTraces: [], subTitle: '' }
    },
  },
  {
    type: 'ichimoku', label: 'IchimokuCloud', group: 'Trend', panel: 'price',
    multi: false, defaultParams: { tenkan: 9, kijun: 26, senkou: 52 },
    paramFields: [
      { key: 'tenkan', label: 'Tenkan (Conversion)', type: 'number', min: 2, max: 100 },
      { key: 'kijun', label: 'Kijun (Base)', type: 'number', min: 2, max: 100 },
      { key: 'senkou', label: 'Senkou B Period', type: 'number', min: 2, max: 200 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { tenkan: tp, kijun: kp, senkou: sp } = params
      const displacement = kp

      // Donchian midline helper
      const donchian = (len) => {
        const out = new Array(n).fill(null)
        for (let i = len - 1; i < n; i++) {
          let hh = -Infinity, ll = Infinity
          for (let j = i - len + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
          out[i] = (hh + ll) / 2
        }
        return out
      }

      const tenkanSen = donchian(tp)
      const kijunSen = donchian(kp)

      // Senkou Span A = (Tenkan + Kijun) / 2, displaced forward
      // Senkou Span B = Donchian(senkou period) / 2, displaced forward
      const senkouBRaw = donchian(sp)

      // Build displaced dates (extend into future)
      const extDates = [...dates]
      if (n > 1) {
        const lastDate = new Date(dates[n - 1])
        for (let i = 1; i <= displacement; i++) {
          const d = new Date(lastDate)
          d.setDate(d.getDate() + i)
          extDates.push(d.toISOString().split('T')[0])
        }
      }

      const spanA = new Array(n + displacement).fill(null)
      const spanB = new Array(n + displacement).fill(null)
      for (let i = 0; i < n; i++) {
        if (tenkanSen[i] != null && kijunSen[i] != null) spanA[i + displacement] = (tenkanSen[i] + kijunSen[i]) / 2
        if (senkouBRaw[i] != null) spanB[i + displacement] = senkouBRaw[i]
      }

      // Chikou Span = close displaced backwards
      const chikou = new Array(n).fill(null)
      for (let i = 0; i < n - displacement; i++) chikou[i] = closes[i + displacement]

      return {
        mainTraces: [
          { x: dates, y: tenkanSen, type: 'scatter', mode: 'lines', name: 'Tenkan', line: { color: '#2962FF', width: 1 }, showlegend: false },
          { x: dates, y: kijunSen, type: 'scatter', mode: 'lines', name: 'Kijun', line: { color: '#E91E63', width: 1 }, showlegend: false },
          { x: dates, y: chikou, type: 'scatter', mode: 'lines', name: 'Chikou', line: { color: '#9C27B0', width: 1, dash: 'dot' }, showlegend: false },
          { x: extDates, y: spanA, type: 'scatter', mode: 'lines', name: 'Senkou A', line: { color: '#4CAF50', width: 1 }, showlegend: false },
          { x: extDates, y: spanB, type: 'scatter', mode: 'lines', name: 'Senkou B', line: { color: '#FF5722', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(76,175,80,0.15)', showlegend: false },
        ],
        subTraces: [],
      }
    },
  },
  {
    type: 'implied_vol', label: 'ImpliedVolatility', group: 'Volatility', panel: 'lower',
    multi: false, defaultParams: { hvPeriod: 20, annualize: 252 },
    paramFields: [
      { key: 'hvPeriod', label: 'HV Period', type: 'number', min: 2, max: 200 },
      { key: 'annualize', label: 'Trading Days', type: 'number', min: 1, max: 365 },
    ],
    compute(records, params, _color, extra) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { hvPeriod, annualize } = params
      const iv = extra?.ivData

      // HV line for comparison
      const logRet = new Array(n).fill(0)
      for (let i = 1; i < n; i++) {
        logRet[i] = closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0
      }
      const hv = new Array(n).fill(null)
      for (let i = hvPeriod; i < n; i++) {
        let sum = 0, sumSq = 0
        for (let j = i - hvPeriod + 1; j <= i; j++) {
          sum += logRet[j]
          sumSq += logRet[j] * logRet[j]
        }
        const mean = sum / hvPeriod
        const variance = sumSq / hvPeriod - mean * mean
        hv[i] = Math.sqrt(Math.max(0, variance) * annualize) * 100
      }

      const traces = [
        { x: dates, y: hv, type: 'scatter', mode: 'lines', name: `HV ${hvPeriod}`, line: { color: '#FF6E40', width: 1.5 }, showlegend: false },
      ]

      // ATM IV as horizontal reference line
      if (iv?.atm_iv) {
        traces.push({
          x: [dates[0], dates[dates.length - 1]], y: [iv.atm_iv, iv.atm_iv],
          type: 'scatter', mode: 'lines',
          name: `ATM IV ${iv.atm_iv}%`,
          line: { color: '#B388FF', width: 2, dash: 'dash' },
          showlegend: false,
        })
        // Call IV line
        if (iv.call_iv) {
          traces.push({
            x: [dates[0], dates[dates.length - 1]], y: [iv.call_iv, iv.call_iv],
            type: 'scatter', mode: 'lines',
            name: `Call IV ${iv.call_iv}%`,
            line: { color: '#69F0AE', width: 1, dash: 'dot' },
            showlegend: false,
          })
        }
        // Put IV line
        if (iv.put_iv) {
          traces.push({
            x: [dates[0], dates[dates.length - 1]], y: [iv.put_iv, iv.put_iv],
            type: 'scatter', mode: 'lines',
            name: `Put IV ${iv.put_iv}%`,
            line: { color: '#FF8A80', width: 1, dash: 'dot' },
            showlegend: false,
          })
        }
      }

      const ivLabel = iv?.atm_iv ? ` | ATM IV: ${iv.atm_iv}%` : ' | IV: N/A'
      return {
        mainTraces: [],
        subTraces: traces,
        subTitle: `IV vs HV (${hvPeriod}d)${ivLabel}`,
      }
    },
  },
  {
    type: 'keltner', label: 'KeltnerChannels', group: 'Volatility', panel: 'price',
    multi: false, defaultParams: { period: 20, atrPeriod: 10, multiplier: 1.5 },
    paramFields: [
      { key: 'period', label: 'EMA Period', type: 'number', min: 2, max: 200 },
      { key: 'atrPeriod', label: 'ATR Period', type: 'number', min: 1, max: 100 },
      { key: 'multiplier', label: 'Multiplier', type: 'number', min: 0.1, max: 10, step: 0.1 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const { period, atrPeriod, multiplier } = params

      // EMA of close
      const emaLine = ema(closes, period)

      // ATR calculation
      const tr = []
      for (let i = 0; i < n; i++) {
        if (i === 0) { tr.push(highs[i] - lows[i]); continue }
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
      }
      // EMA of TR for ATR
      const atr = ema(tr, atrPeriod)

      const upper = [], lower = [], mid = []
      for (let i = 0; i < n; i++) {
        if (emaLine[i] == null || atr[i] == null) { upper.push(null); lower.push(null); mid.push(null); continue }
        mid.push(emaLine[i])
        upper.push(emaLine[i] + multiplier * atr[i])
        lower.push(emaLine[i] - multiplier * atr[i])
      }

      return {
        mainTraces: [
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: 'Keltner Upper', line: { color: '#42A5F5', width: 1 }, showlegend: false },
          { x: dates, y: mid, type: 'scatter', mode: 'lines', name: 'Keltner Mid', line: { color: '#FFA726', width: 1, dash: 'dash' }, showlegend: false },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: 'Keltner Lower', line: { color: '#42A5F5', width: 1 }, showlegend: false },
        ],
        subTraces: [],
      }
    },
  },
  {
    type: 'linregchannel', label: 'LinearRegChannel', group: 'Trend', panel: 'price',
    multi: true, defaultParams: { period: 0 },
    paramFields: [
      { key: 'period', label: 'Period (0=all)', type: 'number', min: 0, max: 2000 },
    ],
    compute(records, params, color) {
      const dates = records.map(r => r.date)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const closes = records.map(r => r.close)
      const n = closes.length
      const lineColor = color || '#AB47BC'
      // period 0 means use all bars
      const period = params.period > 0 ? Math.min(params.period, n) : n

      if (n < 2) return { mainTraces: [], subTraces: [] }

      // Regression over the last `period` bars
      const startIdx = n - period
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
      for (let j = 0; j < period; j++) {
        const y = closes[startIdx + j]
        sumX += j; sumY += y; sumXY += j * y; sumX2 += j * j
      }
      const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX)
      const intercept = (sumY - slope * sumX) / period

      // Find max deviation above and below using highs/lows to enclose all price
      let maxAbove = 0, maxBelow = 0
      for (let j = 0; j < period; j++) {
        const regVal = intercept + slope * j
        const aboveDev = highs[startIdx + j] - regVal
        const belowDev = regVal - lows[startIdx + j]
        if (aboveDev > maxAbove) maxAbove = aboveDev
        if (belowDev > maxBelow) maxBelow = belowDev
      }
      const channelWidth = Math.max(maxAbove, maxBelow)

      // Build arrays: null before channel, straight lines within channel
      const mid = new Array(n).fill(null)
      const upper = new Array(n).fill(null)
      const lower = new Array(n).fill(null)
      for (let j = 0; j < period; j++) {
        const regVal = intercept + slope * j
        mid[startIdx + j] = regVal
        upper[startIdx + j] = regVal + channelWidth
        lower[startIdx + j] = regVal - channelWidth
      }

      return {
        mainTraces: [
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: `LinReg Upper (${period})`, line: { color: lineColor, width: 1, dash: 'dot' }, showlegend: false },
          { x: dates, y: mid, type: 'scatter', mode: 'lines', name: `LinReg (${period})`, line: { color: lineColor, width: 2 }, showlegend: false },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: `LinReg Lower (${period})`, line: { color: lineColor, width: 1, dash: 'dot' }, showlegend: false },
        ],
        subTraces: [],
      }
    },
  },
  {
    type: 'macd', label: 'MACD', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramFields: [
      { key: 'fast', label: 'Fast', type: 'number', min: 1, max: 100 },
      { key: 'slow', label: 'Slow', type: 'number', min: 1, max: 100 },
      { key: 'signal', label: 'Signal', type: 'number', min: 1, max: 100 },
    ],
    compute(records, params) {
      const closes = records.map(r => r.close)
      const dates = records.map(r => r.date)
      const emaFast = ema(closes, params.fast)
      const emaSlow = ema(closes, params.slow)
      const macdLine = closes.map((_, i) => emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)
      const macdValid = macdLine.filter(v => v != null)
      const signalFull = ema(macdValid, params.signal)
      const signalLine = new Array(closes.length).fill(null)
      let si = 0
      for (let i = 0; i < closes.length; i++) { if (macdLine[i] != null) { signalLine[i] = signalFull[si] || null; si++ } }
      const histogram = closes.map((_, i) => macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null)
      const histColors = histogram.map(v => v != null && v >= 0 ? '#26A69A' : '#EF5350')
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: histogram, type: 'bar', name: 'Histogram', marker: { color: histColors }, showlegend: false },
          { x: dates, y: macdLine, type: 'scatter', mode: 'lines', name: 'MACD', line: { color: '#2962FF', width: 1.5 } },
          { x: dates, y: signalLine, type: 'scatter', mode: 'lines', name: 'Signal', line: { color: '#FF6D00', width: 1.5 } },
        ],
        subTitle: `MACD (${params.fast},${params.slow},${params.signal})`,
      }
    },
  },
  {
    type: 'marketforecast', label: 'MarketForecast', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 2, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const p = params.period

      // Stochastic helper: %K = (close - LL) / (HH - LL) * 100
      const stoch = (len) => {
        const out = new Array(n).fill(null)
        for (let i = len - 1; i < n; i++) {
          let hh = -Infinity, ll = Infinity
          for (let j = i - len + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
          out[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
        }
        return out
      }

      // SMA helper
      const smaArr = (arr, len) => {
        const out = new Array(n).fill(null)
        for (let i = len - 1; i < n; i++) {
          let sum = 0, count = 0
          for (let j = i - len + 1; j <= i; j++) { if (arr[j] != null) { sum += arr[j]; count++ } }
          out[i] = count > 0 ? sum / count : null
        }
        return out
      }

      // Momentum: fast stochastic (period)
      const momentum = stoch(p)
      // NearTerm: smoothed stochastic (period, 3-bar SMA)
      const nearTerm = smaArr(stoch(p), 3)
      // Intermediate: longer smoothed stochastic (period * 2, 5-bar SMA)
      const intermediate = smaArr(stoch(p * 2), 5)

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: momentum, type: 'scatter', mode: 'lines', name: 'Momentum', line: { color: '#00E676', width: 1.5 } },
          { x: dates, y: nearTerm, type: 'scatter', mode: 'lines', name: 'NearTerm', line: { color: '#2979FF', width: 1.5 } },
          { x: dates, y: intermediate, type: 'scatter', mode: 'lines', name: 'Intermediate', line: { color: '#FF5252', width: 1.5 } },
        ],
        subTitle: `MarketForecast (${p})`,
        shapes: [
          { type: 'line', y0: 80, y1: 80, x0: 0, x1: 1, xref: 'paper', line: { color: '#888', width: 1, dash: 'dot' } },
          { type: 'line', y0: 20, y1: 20, x0: 0, x1: 1, xref: 'paper', line: { color: '#888', width: 1, dash: 'dot' } },
        ],
      }
    },
  },
  {
    type: 'moneyflow', label: 'MoneyFlowIndex', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const volumes = records.map(r => r.volume || 0)
      const n = closes.length
      const p = params.period

      // Money Flow Index (MFI) - volume-weighted RSI
      // Typical price = (H + L + C) / 3
      // Raw MF = TP * Volume
      // MFI = 100 - 100 / (1 + positive MF / negative MF)
      const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
      const rawMF = tp.map((t, i) => t * volumes[i])

      const mfi = new Array(n).fill(null)
      for (let i = p; i < n; i++) {
        let posMF = 0, negMF = 0
        for (let j = i - p + 1; j <= i; j++) {
          if (tp[j] > tp[j - 1]) posMF += rawMF[j]
          else if (tp[j] < tp[j - 1]) negMF += rawMF[j]
        }
        mfi[i] = negMF === 0 ? 100 : 100 - 100 / (1 + posMF / negMF)
      }

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: mfi, type: 'scatter', mode: 'lines', name: 'MFI', line: { color: '#FFD740', width: 1.5 } },
        ],
        subTitle: `MoneyFlow (${p})`,
        shapes: [
          { type: 'line', y0: 80, y1: 80, x0: 0, x1: 1, xref: 'paper', line: { color: '#888', width: 1, dash: 'dot' } },
          { type: 'line', y0: 20, y1: 20, x0: 0, x1: 1, xref: 'paper', line: { color: '#888', width: 1, dash: 'dot' } },
        ],
      }
    },
  },
  {
    type: 'obv', label: 'OnBalanceVolume', group: 'Volume', panel: 'lower',
    multi: false, defaultParams: {},
    paramFields: [],
    compute(records) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const volumes = records.map(r => r.volume || 0)
      const obv = [0]
      for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i])
        else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i])
        else obv.push(obv[i - 1])
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: obv, type: 'scatter', mode: 'lines', name: 'OBV', line: { color: '#26C6DA', width: 1.5 } },
        ],
        subTitle: 'On Balance Volume',
      }
    },
  },
  {
    type: 'ray_bull_bear', label: 'RayBullBearPower', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 13 },
    paramFields: [{ key: 'period', label: 'EMA Period', type: 'number', min: 2, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const emaLine = ema(closes, params.period)

      // Bull Power = High - EMA, Bear Power = Low - EMA
      const bull = [], bear = []
      for (let i = 0; i < closes.length; i++) {
        if (emaLine[i] == null) { bull.push(null); bear.push(null); continue }
        bull.push(highs[i] - emaLine[i])
        bear.push(lows[i] - emaLine[i])
      }

      const bullColors = bull.map(v => v != null && v >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)')
      const bearColors = bear.map(v => v != null && v >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)')

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: bull, type: 'bar', name: 'Bull Power', marker: { color: bullColors }, showlegend: true },
          { x: dates, y: bear, type: 'bar', name: 'Bear Power', marker: { color: bearColors }, showlegend: true },
        ],
        subTitle: `Ray Bull/Bear Power (${params.period})`,
      }
    },
  },
  {
    type: 'rsi', label: 'RSI', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const period = params.period
      const rsi = new Array(closes.length).fill(null)
      if (closes.length < 2) return { mainTraces: [], subTraces: [], subTitle: '' }
      let avgGain = 0, avgLoss = 0
      for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1]
        const gain = change > 0 ? change : 0
        const loss = change < 0 ? -change : 0
        if (i <= period) {
          avgGain += gain / period
          avgLoss += loss / period
          rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        } else {
          avgGain = (avgGain * (period - 1) + gain) / period
          avgLoss = (avgLoss * (period - 1) + loss) / period
          rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        }
      }
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: rsi, type: 'scatter', mode: 'lines', name: `RSI ${period}`, line: { color: '#AB47BC', width: 1.5 }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [70, 70], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [30, 30], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `RSI (${period})`,
      }
    },
  },
  {
    type: 'stoch', label: 'Stochastic', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { kPeriod: 14, dPeriod: 3, smooth: 3 },
    paramFields: [
      { key: 'kPeriod', label: '%K Period', type: 'number', min: 1, max: 100 },
      { key: 'dPeriod', label: '%D Period', type: 'number', min: 1, max: 50 },
      { key: 'smooth', label: 'Smooth', type: 'number', min: 1, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const { kPeriod, dPeriod, smooth } = params
      const n = records.length
      // Raw %K — progressive window from bar 0
      const rawK = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - kPeriod + 1)
        let hh = -Infinity, ll = Infinity
        for (let j = start; j <= i; j++) {
          if (records[j].high > hh) hh = records[j].high
          if (records[j].low < ll) ll = records[j].low
        }
        const range = hh - ll
        rawK[i] = range > 0 ? (records[i].close - ll) / range * 100 : 50
      }
      // Slow %K = SMA of raw %K (progressive)
      const slowK = sma(rawK, smooth)
      // %D = SMA of slow %K (progressive)
      const pctD = sma(slowK, dPeriod)
      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: slowK, type: 'scatter', mode: 'lines', name: `%K`, line: { color: '#2196F3', width: 1.5 }, showlegend: false },
          { x: dates, y: pctD, type: 'scatter', mode: 'lines', name: `%D`, line: { color: '#FF6D00', width: 1.5, dash: 'dash' }, showlegend: false },
          { x: [dates[0], dates[dates.length - 1]], y: [80, 80], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[dates.length - 1]], y: [20, 20], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `Stochastic (${kPeriod},${dPeriod},${smooth})`,
      }
    },
  },
  {
    type: 'stoch_macd', label: 'StochasticMACD', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { fast: 12, slow: 26, signal: 9, stochPeriod: 45 },
    paramFields: [
      { key: 'fast', label: 'MACD Fast', type: 'number', min: 1, max: 100 },
      { key: 'slow', label: 'MACD Slow', type: 'number', min: 1, max: 100 },
      { key: 'signal', label: 'Signal', type: 'number', min: 1, max: 50 },
      { key: 'stochPeriod', label: 'Stoch Period', type: 'number', min: 2, max: 100 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { fast, slow, signal, stochPeriod } = params

      // Step 1: Compute MACD line (EMA starts from bar 0)
      const emaFast = ema(closes, fast)
      const emaSlow = ema(closes, slow)
      const macdLine = closes.map((_, i) => emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)

      // Step 2: Apply Stochastic to MACD line — progressive window from bar 0
      const stochMACD = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        if (macdLine[i] == null) continue
        const lookback = Math.min(stochPeriod, i + 1)
        let hh = -Infinity, ll = Infinity
        for (let j = i - lookback + 1; j <= i; j++) {
          if (macdLine[j] == null) continue
          if (macdLine[j] > hh) hh = macdLine[j]
          if (macdLine[j] < ll) ll = macdLine[j]
        }
        if (hh === -Infinity) continue
        stochMACD[i] = hh === ll ? 50 : ((macdLine[i] - ll) / (hh - ll)) * 100
      }

      // Step 3: Signal line = EMA of Stochastic MACD
      const validStoch = stochMACD.filter(v => v != null)
      const sigFull = ema(validStoch, signal)
      const sigLine = new Array(n).fill(null)
      let si = 0
      for (let i = 0; i < n; i++) { if (stochMACD[i] != null) { sigLine[i] = sigFull[si] || null; si++ } }

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: stochMACD, type: 'scatter', mode: 'lines', name: 'Stoch MACD', line: { color: '#2962FF', width: 1.5 } },
          { x: dates, y: sigLine, type: 'scatter', mode: 'lines', name: 'Signal', line: { color: '#FF6D00', width: 1.5, dash: 'dash' } },
          { x: [dates[0], dates[n - 1]], y: [80, 80], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[n - 1]], y: [20, 20], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `StochMACD (${fast},${slow},${signal},${stochPeriod})`,
      }
    },
  },
  {
    type: 'sma', label: 'SimpleMovingAvg', group: 'Moving Averages', panel: 'price',
    multi: true, defaultParams: { period: 50 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 1, max: 500 }],
    compute(records, params, color) {
      const vals = sma(records.map(r => r.close), params.period)
      return {
        mainTraces: [{ x: records.map(r => r.date), y: vals, type: 'scatter', mode: 'lines', name: `SMA ${params.period}`, line: { width: 1.5, color: color || '#FF6B35' } }],
        subTraces: [], subTitle: '',
      }
    },
  },
  {
    type: 'ulcer_index', label: 'UlcerIndex', group: 'Volatility', panel: 'lower',
    multi: false, defaultParams: { period: 14 },
    paramFields: [{ key: 'period', label: 'Period', type: 'number', min: 2, max: 100 }],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const p = params.period
      const ui = new Array(n).fill(null)

      for (let i = 0; i < n; i++) {
        // Progressive window: use available bars from 0..i, up to period
        const start = Math.max(0, i - p + 1)
        const len = i - start + 1
        let maxClose = -Infinity
        for (let j = start; j <= i; j++) { if (closes[j] > maxClose) maxClose = closes[j] }
        let sumSq = 0
        for (let j = start; j <= i; j++) {
          const pctDD = ((closes[j] - maxClose) / maxClose) * 100
          sumSq += pctDD * pctDD
        }
        ui[i] = Math.sqrt(sumSq / len)
      }

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: ui, type: 'scatter', mode: 'lines', name: 'Ulcer Index', line: { color: '#CE93D8', width: 1.5 } },
        ],
        subTitle: `Ulcer Index (${p})`,
      }
    },
  },
  {
    type: 'ultimate_bands', label: 'UltimateBands', group: 'Volatility', panel: 'price',
    multi: false, defaultParams: { period: 14, multiplier: 2 },
    paramFields: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 200 },
      { key: 'multiplier', label: 'Multiplier', type: 'number', min: 0.5, max: 5, step: 0.5 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const { period, multiplier } = params

      // True Range
      const tr = []
      for (let i = 0; i < n; i++) {
        if (i === 0) { tr.push(highs[i] - lows[i]); continue }
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
      }

      // EMA of close, EMA of TR
      const midLine = ema(closes, period)
      const atr = ema(tr, period)

      const upper = [], lower = [], mid = []
      for (let i = 0; i < n; i++) {
        if (midLine[i] == null || atr[i] == null) { upper.push(null); lower.push(null); mid.push(null); continue }
        mid.push(midLine[i])
        upper.push(midLine[i] + multiplier * atr[i])
        lower.push(midLine[i] - multiplier * atr[i])
      }

      return {
        mainTraces: [
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: 'UB Upper', line: { color: '#42A5F5', width: 1 }, showlegend: false },
          { x: dates, y: mid, type: 'scatter', mode: 'lines', name: 'UB Mid', line: { color: '#FFA726', width: 1, dash: 'dash' }, showlegend: false },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: 'UB Lower', line: { color: '#42A5F5', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(66,165,245,0.08)', showlegend: false },
        ],
        subTraces: [],
      }
    },
  },
  {
    type: 'ultimate_channels', label: 'UltimateChannels', group: 'Volatility', panel: 'price',
    multi: false, defaultParams: { period: 20 },
    paramFields: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 200 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const closes = records.map(r => r.close)
      const n = closes.length
      const p = params.period

      // Upper channel = highest high over period, Lower = lowest low over period
      // Mid = (upper + lower) / 2
      const upper = new Array(n).fill(null)
      const lower = new Array(n).fill(null)
      const mid = new Array(n).fill(null)

      for (let i = p - 1; i < n; i++) {
        let hh = -Infinity, ll = Infinity
        for (let j = i - p + 1; j <= i; j++) {
          if (highs[j] > hh) hh = highs[j]
          if (lows[j] < ll) ll = lows[j]
        }
        upper[i] = hh
        lower[i] = ll
        mid[i] = (hh + ll) / 2
      }

      return {
        mainTraces: [
          { x: dates, y: upper, type: 'scatter', mode: 'lines', name: 'UC Upper', line: { color: '#26A69A', width: 1 }, showlegend: false },
          { x: dates, y: mid, type: 'scatter', mode: 'lines', name: 'UC Mid', line: { color: '#BDBDBD', width: 1, dash: 'dash' }, showlegend: false },
          { x: dates, y: lower, type: 'scatter', mode: 'lines', name: 'UC Lower', line: { color: '#EF5350', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(189,189,189,0.06)', showlegend: false },
        ],
        subTraces: [],
      }
    },
  },
  {
    type: 'ultimate_osc', label: 'UltimateOscillator', group: 'Oscillators', panel: 'lower',
    multi: false, defaultParams: { p1: 7, p2: 14, p3: 28 },
    paramFields: [
      { key: 'p1', label: 'Period 1', type: 'number', min: 1, max: 50 },
      { key: 'p2', label: 'Period 2', type: 'number', min: 1, max: 100 },
      { key: 'p3', label: 'Period 3', type: 'number', min: 1, max: 200 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const { p1, p2, p3 } = params

      // Buying Pressure = Close - Min(Low, Prior Close)
      // True Range = Max(High, Prior Close) - Min(Low, Prior Close)
      const bp = new Array(n).fill(0)
      const tr = new Array(n).fill(0)
      for (let i = 1; i < n; i++) {
        const minLC = Math.min(lows[i], closes[i - 1])
        const maxHC = Math.max(highs[i], closes[i - 1])
        bp[i] = closes[i] - minLC
        tr[i] = maxHC - minLC
      }

      // Rolling sums for each period — progressive window from bar 1
      const uo = new Array(n).fill(null)
      for (let i = 1; i < n; i++) {
        const s1 = Math.max(1, i - p1 + 1), s2 = Math.max(1, i - p2 + 1), s3 = Math.max(1, i - p3 + 1)
        let bpSum1 = 0, trSum1 = 0, bpSum2 = 0, trSum2 = 0, bpSum3 = 0, trSum3 = 0
        for (let j = s1; j <= i; j++) { bpSum1 += bp[j]; trSum1 += tr[j] }
        for (let j = s2; j <= i; j++) { bpSum2 += bp[j]; trSum2 += tr[j] }
        for (let j = s3; j <= i; j++) { bpSum3 += bp[j]; trSum3 += tr[j] }
        const avg1 = trSum1 > 0 ? bpSum1 / trSum1 : 0
        const avg2 = trSum2 > 0 ? bpSum2 / trSum2 : 0
        const avg3 = trSum3 > 0 ? bpSum3 / trSum3 : 0
        uo[i] = ((4 * avg1 + 2 * avg2 + avg3) / 7) * 100
      }

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: uo, type: 'scatter', mode: 'lines', name: 'UO', line: { color: '#7E57C2', width: 1.5 } },
          { x: [dates[0], dates[n - 1]], y: [70, 70], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
          { x: [dates[0], dates[n - 1]], y: [30, 30], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
        ],
        subTitle: `Ultimate Osc (${p1},${p2},${p3})`,
      }
    },
  },
  {
    type: 'vectorvest', label: 'VectorVest', group: 'Signals', panel: 'price',
    multi: false, defaultParams: { fastEma: 8, slowEma: 21, rsiPeriod: 14, rsiOB: 70, rsiOS: 30 },
    paramFields: [
      { key: 'fastEma', label: 'Fast EMA', type: 'number', min: 2, max: 50 },
      { key: 'slowEma', label: 'Slow EMA', type: 'number', min: 5, max: 200 },
      { key: 'rsiPeriod', label: 'RSI Period', type: 'number', min: 2, max: 50 },
      { key: 'rsiOB', label: 'RSI Overbought', type: 'number', min: 50, max: 95 },
      { key: 'rsiOS', label: 'RSI Oversold', type: 'number', min: 5, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const n = closes.length
      const { fastEma: fp, slowEma: sp, rsiPeriod: rp, rsiOB, rsiOS } = params

      const emaF = ema(closes, fp)
      const emaS = ema(closes, sp)

      // RSI
      const rsi = new Array(n).fill(null)
      let avgGain = 0, avgLoss = 0
      for (let i = 1; i < n; i++) {
        const change = closes[i] - closes[i - 1]
        const gain = change > 0 ? change : 0
        const loss = change < 0 ? -change : 0
        if (i <= rp) {
          avgGain += gain / rp; avgLoss += loss / rp
          if (i === rp) rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        } else {
          avgGain = (avgGain * (rp - 1) + gain) / rp
          avgLoss = (avgLoss * (rp - 1) + loss) / rp
          rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        }
      }

      // Generate BUY/SELL signals
      // BUY: fast EMA crosses above slow EMA AND RSI not overbought
      // SELL: fast EMA crosses below slow EMA AND RSI not oversold (confirmation of weakness)
      const buyDates = [], buyPrices = [], buyText = []
      const sellDates = [], sellPrices = [], sellText = []

      for (let i = 1; i < n; i++) {
        if (emaF[i] == null || emaS[i] == null || emaF[i - 1] == null || emaS[i - 1] == null) continue
        // Bullish crossover
        if (emaF[i - 1] <= emaS[i - 1] && emaF[i] > emaS[i]) {
          if (rsi[i] == null || rsi[i] < rsiOB) {
            buyDates.push(dates[i]); buyPrices.push(closes[i] * 0.97)
            buyText.push(`BUY $${closes[i].toFixed(2)}`)
          }
        }
        // Bearish crossover
        if (emaF[i - 1] >= emaS[i - 1] && emaF[i] < emaS[i]) {
          if (rsi[i] == null || rsi[i] > rsiOS) {
            sellDates.push(dates[i]); sellPrices.push(closes[i] * 1.03)
            sellText.push(`SELL $${closes[i].toFixed(2)}`)
          }
        }
      }

      // Background color bands: green when fast > slow, red when fast < slow
      const bgShapes = []
      let bandStart = null, bandBull = null
      for (let i = 0; i < n; i++) {
        if (emaF[i] == null || emaS[i] == null) continue
        const isBull = emaF[i] > emaS[i]
        if (bandStart === null) { bandStart = i; bandBull = isBull; continue }
        if (isBull !== bandBull) {
          bgShapes.push({
            type: 'rect', x0: dates[bandStart], x1: dates[i - 1],
            y0: 0, y1: 1, yref: 'paper',
            fillcolor: bandBull ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)',
            line: { width: 0 }, layer: 'below',
          })
          bandStart = i; bandBull = isBull
        }
      }
      if (bandStart !== null) {
        bgShapes.push({
          type: 'rect', x0: dates[bandStart], x1: dates[n - 1],
          y0: 0, y1: 1, yref: 'paper',
          fillcolor: bandBull ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)',
          line: { width: 0 }, layer: 'below',
        })
      }

      return {
        mainTraces: [
          { x: dates, y: emaF, type: 'scatter', mode: 'lines', name: `VV Fast (${fp})`, line: { color: '#4CAF50', width: 1 }, showlegend: false },
          { x: dates, y: emaS, type: 'scatter', mode: 'lines', name: `VV Slow (${sp})`, line: { color: '#F44336', width: 1 }, showlegend: false },
          { x: buyDates, y: buyPrices, type: 'scatter', mode: 'markers+text', name: 'BUY',
            marker: { symbol: 'triangle-up', size: 14, color: '#00E676' },
            text: buyText, textposition: 'bottom center', textfont: { color: '#00E676', size: 10 },
            showlegend: false },
          { x: sellDates, y: sellPrices, type: 'scatter', mode: 'markers+text', name: 'SELL',
            marker: { symbol: 'triangle-down', size: 14, color: '#FF1744' },
            text: sellText, textposition: 'top center', textfont: { color: '#FF1744', size: 10 },
            showlegend: false },
        ],
        subTraces: [],
        shapes: bgShapes,
      }
    },
  },
  {
    type: 'ttm_squeeze', label: 'TTM Squeeze', group: 'Volatility', panel: 'lower',
    multi: false,
    defaultParams: { bbPeriod: 20, bbMult: 2.0, kcPeriod: 20, kcMult: 1.5, momPeriod: 12 },
    paramFields: [
      { key: 'bbPeriod', label: 'BB Period', type: 'number', min: 2, max: 100 },
      { key: 'bbMult', label: 'BB Mult', type: 'number', min: 0.5, max: 5, step: 0.1 },
      { key: 'kcPeriod', label: 'KC Period', type: 'number', min: 2, max: 100 },
      { key: 'kcMult', label: 'KC Mult', type: 'number', min: 0.1, max: 5, step: 0.1 },
      { key: 'momPeriod', label: 'Mom Period', type: 'number', min: 2, max: 50 },
    ],
    compute(records, params) {
      const dates = records.map(r => r.date)
      const closes = records.map(r => r.close)
      const highs = records.map(r => r.high)
      const lows = records.map(r => r.low)
      const n = closes.length
      const { bbPeriod, bbMult, kcPeriod, kcMult, momPeriod } = params

      if (n < 2) return { mainTraces: [], subTraces: [], subTitle: '' }

      // Bollinger Bands
      const bbMid = sma(closes, bbPeriod)
      const bbUpper = new Array(n).fill(null)
      const bbLower = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        if (bbMid[i] == null) continue
        const w = Math.min(bbPeriod, i + 1)
        let sumSq = 0
        for (let j = i - w + 1; j <= i; j++) sumSq += (closes[j] - bbMid[i]) ** 2
        const sd = Math.sqrt(sumSq / w)
        bbUpper[i] = bbMid[i] + bbMult * sd
        bbLower[i] = bbMid[i] - bbMult * sd
      }

      // Keltner Channels
      const kcMid = ema(closes, kcPeriod)
      const tr = []
      for (let i = 0; i < n; i++) {
        if (i === 0) { tr.push(highs[i] - lows[i]); continue }
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
      }
      const atr = ema(tr, kcPeriod)
      const kcUpper = new Array(n).fill(null)
      const kcLower = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        if (kcMid[i] == null || atr[i] == null) continue
        kcUpper[i] = kcMid[i] + kcMult * atr[i]
        kcLower[i] = kcMid[i] - kcMult * atr[i]
      }

      // Squeeze detection: BB inside KC = squeeze on
      const sqzOn = new Array(n).fill(false)
      for (let i = 0; i < n; i++) {
        if (bbLower[i] != null && kcLower[i] != null) {
          sqzOn[i] = bbLower[i] > kcLower[i] && bbUpper[i] < kcUpper[i]
        }
      }

      // Momentum: linear regression of (close - avg(highest high, lowest low, KC midline))
      const mom = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        const w = Math.min(kcPeriod, i + 1)
        let hh = -Infinity, ll = Infinity
        for (let j = i - w + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]) }
        const donchianMid = (hh + ll) / 2
        const avg = (donchianMid + (kcMid[i] || closes[i])) / 2
        mom[i] = closes[i] - avg
      }

      // Linear regression value of momentum over momPeriod
      const linreg = new Array(n).fill(null)
      for (let i = 0; i < n; i++) {
        const len = Math.min(momPeriod, i + 1)
        if (len < 2) { linreg[i] = mom[i]; continue }
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
        for (let j = 0; j < len; j++) {
          const y = mom[i - len + 1 + j]
          sumX += j; sumY += y; sumXY += j * y; sumX2 += j * j
        }
        const slope = (len * sumXY - sumX * sumY) / (len * sumX2 - sumX * sumX)
        const intercept = (sumY - slope * sumX) / len
        linreg[i] = intercept + slope * (len - 1)
      }

      // Momentum histogram colors: increasing positive = aqua, decreasing positive = dark blue,
      // increasing negative (toward zero) = dark red, decreasing negative = red
      const momColors = linreg.map((v, i) => {
        if (v == null) return '#999'
        const prev = i > 0 ? linreg[i - 1] : 0
        if (v >= 0) return v > prev ? '#00BCD4' : '#0D47A1'
        return v < prev ? '#F44336' : '#B71C1C'
      })

      // Squeeze dots on zero line
      const sqzColors = sqzOn.map(on => on ? '#F44336' : '#4CAF50')
      const sqzY = new Array(n).fill(0)

      return {
        mainTraces: [],
        subTraces: [
          { x: dates, y: linreg, type: 'bar', name: 'Momentum', marker: { color: momColors }, showlegend: false },
          { x: dates, y: sqzY, type: 'scatter', mode: 'markers', name: 'Squeeze',
            marker: { color: sqzColors, size: 5, symbol: 'circle' }, showlegend: false },
        ],
        subTitle: `TTM Squeeze (${bbPeriod}, ${bbMult}, ${kcPeriod}, ${kcMult})`,
      }
    },
  },
]

// ── Constants ────────────────────────────────────────────────────────────────

const PERIODS = [
  { value: '1mo', label: '1M' }, { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' }, { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' }, { value: '2y', label: '2Y' },
  { value: '5y', label: '5Y' }, { value: 'max', label: 'Max' },
]

const RETURN_MODES = [
  { value: 'total', label: 'Total Return', desc: 'Blends between Price Only (0%) and full DRIP (100%)' },
  { value: 'price', label: 'Price Only', desc: 'Share price change only — dividends ignored' },
  { value: 'pricediv', label: 'Price + Divs', desc: 'Price change plus dividends as cash — no reinvestment' },
  { value: 'both', label: 'Both', desc: 'Overlays blended return and Price Only' },
  { value: 'all3', label: 'All Three', desc: 'Price Only, blended %, 100% DRIP' },
  { value: 'all4', label: 'All Four', desc: 'Price Only, Price+Div, blended %, 100% DRIP' },
]

const CHIP_COLORS = ['#a0f0c0', '#FFD700', '#ff7eb3', '#b39ddb', '#ff8a65', '#4dd0e1', '#aed581', '#f48fb1']

// Match the web version: same blue family, distinct dash patterns
const TRACE_STYLES = {
  price:    { dash: 'dot',       color: '#7ecfff', width: 2,   label: 'Price' },
  pricediv: { dash: 'longdash',  color: '#7ecfff', width: 2.5, label: 'Price + Divs' },
  blend:    { dash: 'dash',      color: '#7ecfff', width: 2.5, label: '' },  // label set dynamically with %
  total:    { dash: 'solid',     color: '#7ecfff', width: 3,   label: 'Total Return' },
  drip:     { dash: 'solid',     color: '#7ecfff', width: 3,   label: '100% DRIP' },
}

function pct(v) { return v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—' }
function pctColor(v) { return v >= 0 ? '#4caf50' : '#ef5350' }

// ── Main Component ───────────────────────────────────────────────────────────

export default function ETFScreen() {
  const [tab, setTab] = useState('technical') // 'technical' | 'returns'
  const [ticker, setTicker] = useState('')
  const [period, setPeriod] = useState('1y')
  const [interval, setInterval_] = useState('') // '' = auto
  const [chartType, setChartType] = useState('candlestick')
  const [chartScale, setChartScale] = useState(() => localStorage.getItem('etf_chartScale') || 'linear')
  const [yExpandTop, setYExpandTop] = useState(() => localStorage.getItem('etf_yExpandTop') ?? '10')
  const [yExpandBot, setYExpandBot] = useState(() => localStorage.getItem('etf_yExpandBot') ?? '10')
  const [xExpand, setXExpand] = useState(() => localStorage.getItem('etf_xExpand') ?? '0')
  const yExpandTopNum = Math.max(0, parseInt(yExpandTop) || 0)
  const yExpandBotNum = Math.max(0, parseInt(yExpandBot) || 0)
  const xExpandNum = Math.max(0, parseInt(xExpand) || 0)
  const [records, setRecords] = useState([])
  const [tickerName, setTickerName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [portfolioTickers, setPortfolioTickers] = useState([])
  const [ivData, setIvData] = useState(null) // { atm_iv, call_iv, put_iv, expiration }

  // Drawing tools state
  const [drawMode, setDrawMode] = useState(null) // 'trendline', 'hline', 'rect', 'path', 'fib', null
  const [drawColor, setDrawColor] = useState('#FFD740')
  const [drawDash, setDrawDash] = useState('solid') // 'solid', 'dash', 'dot'
  const [drawnShapes, setDrawnShapes] = useState([])
  const [fibClicks, setFibClicks] = useState([]) // [{x, y}, {x, y}] for fib retracement
  const [fibSets, setFibSets] = useState([]) // array of { shapes, annotations } for each fib drawing
  const plotRef = useRef(null)
  const fibClicksRef = useRef(fibClicks)
  fibClicksRef.current = fibClicks

  // Fib retracement — build levels from two clicks
  const buildFib = useCallback((p1, p2) => {
    const high = Math.max(p1.y, p2.y)
    const low = Math.min(p1.y, p2.y)
    const diff = high - low
    if (diff === 0) return
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
    const colors = ['#EF5350', '#FF9800', '#FFD740', '#4CAF50', '#2196F3', '#9C27B0', '#EF5350']
    const xLeft = p1.x < p2.x ? p1.x : p2.x
    const xRight = p1.x < p2.x ? p2.x : p1.x
    const newShapes = levels.map((lvl, idx) => ({
      type: 'line', x0: xLeft, x1: xRight,
      y0: high - diff * lvl, y1: high - diff * lvl,
      xref: 'x', yref: 'y',
      line: { color: colors[idx], width: 1.5, dash: lvl === 0 || lvl === 1 ? 'solid' : 'dash' },
    }))
    const newAnnotations = levels.map((lvl, idx) => ({
      x: xRight, y: high - diff * lvl,
      xref: 'x', yref: 'y', xanchor: 'left',
      text: ` ${(lvl * 100).toFixed(1)}% ($${(high - diff * lvl).toFixed(2)})`,
      showarrow: false,
      font: { color: colors[idx], size: 10 },
    }))
    setFibSets(prev => [...prev, { shapes: newShapes, annotations: newAnnotations }])
  }, [])

  // Fib click via transparent overlay — bypasses Plotly completely
  // Overlay click handler for Fib and H-Line modes
  const handleOverlayClick = useCallback((evt) => {
    const container = plotRef.current
    if (!container) return
    const plotEl = container.querySelector('.js-plotly-plot')
    if (!plotEl || !plotEl._fullLayout) return
    const xa = plotEl._fullLayout.xaxis
    const ya = plotEl._fullLayout.yaxis
    if (!xa || !ya) return

    const plotArea = plotEl.querySelector('.draglayer .nsewdrag')
    if (!plotArea) return
    const rect = plotArea.getBoundingClientRect()

    const px = evt.clientX - rect.left
    const py = evt.clientY - rect.top
    const w = rect.width
    const h = rect.height

    if (px < 0 || py < 0 || px > w || py > h) return

    const xRange = xa.range
    const yRange = ya.range
    if (!xRange || !yRange) return

    const x0ms = new Date(xRange[0]).getTime()
    const x1ms = new Date(xRange[1]).getTime()
    const xDate = new Date(x0ms + (px / w) * (x1ms - x0ms)).toISOString().split('T')[0]

    const y0 = yRange[0]
    const y1 = yRange[1]
    const yVal = y1 - (py / h) * (y1 - y0)

    if (drawMode === 'hline') {
      // Draw horizontal line spanning entire x-axis at clicked y-value
      setDrawnShapes(prev => [...prev, {
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: yVal, y1: yVal, yref: 'y',
        line: { color: drawColor, width: 2, dash: drawDash },
      }])
      return
    }

    // Fib mode
    const click = { x: xDate, y: yVal }
    if (fibClicksRef.current.length === 0) {
      setFibClicks([click])
    } else {
      buildFib(fibClicksRef.current[0], click)
      setFibClicks([])
    }
  }, [buildFib, drawMode, drawColor, drawDash])

  // Technical indicators — TOS-style: dynamic instances keyed by unique ID
  // Each entry: { type, enabled, visible, params, color, settingsOpen }
  const [indicators, setIndicators] = useState(() => {
    try {
      const saved = localStorage.getItem('etf-indicators')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Reset settingsOpen on reload
        Object.values(parsed).forEach(s => { s.settingsOpen = false })
        return parsed
      }
    } catch { /* ignore */ }
    // Default: StochasticMACD enabled
    return {
      stoch_macd: { type: 'stoch_macd', enabled: true, visible: true, params: { fast: 12, slow: 26, signal: 9, stochPeriod: 45 }, color: null, settingsOpen: false },
    }
  })
  // Persist indicators to localStorage on every change
  useEffect(() => {
    localStorage.setItem('etf-indicators', JSON.stringify(indicators))
  }, [indicators])

  const [showVolume, setShowVolume] = useState(() => {
    try { return localStorage.getItem('etf-show-volume') !== 'false' } catch { return true }
  })
  useEffect(() => { localStorage.setItem('etf-show-volume', showVolume) }, [showVolume])
  useEffect(() => { localStorage.setItem('etf_chartScale', chartScale) }, [chartScale])
  useEffect(() => { localStorage.setItem('etf_yExpandTop', String(yExpandTop)) }, [yExpandTop])
  useEffect(() => { localStorage.setItem('etf_yExpandBot', String(yExpandBot)) }, [yExpandBot])
  useEffect(() => { localStorage.setItem('etf_xExpand', String(xExpand)) }, [xExpand])

  const [studySearch, setStudySearch] = useState('')
  const [studiesPanelOpen, setStudiesPanelOpen] = useState(false)

  // Returns tab state
  const [returnMode, setReturnMode] = useState('total')
  const [reinvest, setReinvest] = useState(100)
  const [compareTickers, setCompareTickers] = useState([])
  const [compareInput, setCompareInput] = useState('')
  const [returnData, setReturnData] = useState(null)
  const [returnLoading, setReturnLoading] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/etf-screen/tickers`)
      .then(r => r.json())
      .then(d => setPortfolioTickers(d.tickers || []))
      .catch(() => {})
  }, [])

  // Load OHLCV for technical tab
  const loadTechnical = useCallback(() => {
    if (!ticker.trim()) return
    setLoading(true)
    setError('')
    const intParam = interval ? `&interval=${interval}` : ''
    fetch(`${API_BASE}/api/etf-screen/data?ticker=${encodeURIComponent(ticker.trim())}&period=${period}&mode=ohlcv${intParam}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRecords([]); setTickerName(''); setIvData(null) }
        else { setRecords(d.records); setTickerName(d.name || d.ticker); setIvData(d.iv || null) }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, period, interval])

  // Load return data
  const loadReturns = useCallback(() => {
    // Use primary ticker, or fall back to first comparison ticker
    const primary = ticker.trim() || (compareTickers.length ? compareTickers[0] : '')
    if (!primary) return
    setReturnLoading(true)
    setError('')
    const extra = compareTickers.filter(t => t !== primary).join(',')
    const url = `${API_BASE}/api/etf-screen/data?ticker=${encodeURIComponent(primary)}&period=${period}&mode=${returnMode}&reinvest=${reinvest}&extra=${encodeURIComponent(extra)}`
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setReturnData(null) }
        else { setReturnData(d) }
      })
      .catch(e => setError(e.message))
      .finally(() => setReturnLoading(false))
  }, [ticker, period, returnMode, reinvest, compareTickers])

  // Auto-reload returns chart when mode/reinvest changes (only if already loaded)
  useEffect(() => {
    if (tab === 'returns' && returnData) loadReturns()
  }, [returnMode, reinvest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reload chart when period or interval changes (only if data already loaded)
  useEffect(() => {
    if (tab === 'technical' && records.length) loadTechnical()
    else if (tab === 'returns' && returnData) loadReturns()
  }, [period, interval]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadChart = tab === 'technical' ? loadTechnical : loadReturns
  const isLoading = tab === 'technical' ? loading : returnLoading
  const canLoad = tab === 'technical' ? !!ticker.trim() : !!(ticker.trim() || compareTickers.length)

  const handleKeyDown = (e) => { if (e.key === 'Enter') loadChart() }

  const addCompare = () => {
    const s = compareInput.trim().toUpperCase()
    if (s && s !== ticker.toUpperCase() && !compareTickers.includes(s)) {
      setCompareTickers(prev => [...prev, s])
    }
    setCompareInput('')
  }
  const removeCompare = (s) => setCompareTickers(prev => prev.filter(t => t !== s))

  const addStudy = (type) => {
    const template = STUDY_TEMPLATES.find(t => t.type === type)
    if (!template) return
    if (!template.multi) {
      // Single-instance: use type as ID, skip if already active
      if (Object.values(indicators).some(s => s.type === type && s.enabled)) return
      setIndicators(prev => ({ ...prev, [type]: { type, enabled: true, visible: true, params: { ...template.defaultParams }, color: null, settingsOpen: false } }))
      return
    }
    // Multi-instance: generate unique ID, pick next color
    setIndicators(prev => {
      const existing = Object.keys(prev).filter(k => k.startsWith(type + '_'))
      const maxNum = existing.reduce((max, k) => Math.max(max, parseInt(k.split('_').pop()) || 0), 0)
      const id = `${type}_${maxNum + 1}`
      // Count ALL multi-instance studies so SMA and EMA don't share colors
      const allMultiCount = Object.values(prev).filter(s => {
        const t = STUDY_TEMPLATES.find(st => st.type === s.type)
        return t?.multi && s.enabled
      }).length
      const color = MA_COLORS[allMultiCount % MA_COLORS.length]
      return { ...prev, [id]: { type, enabled: true, visible: true, params: { ...template.defaultParams }, color, settingsOpen: false } }
    })
  }
  const removeStudy = (id) => setIndicators(prev => { const next = { ...prev }; delete next[id]; return next })
  const toggleVisibility = (id) => setIndicators(prev => ({ ...prev, [id]: { ...prev[id], visible: !prev[id].visible } }))
  const toggleSettings = (id) => setIndicators(prev => ({ ...prev, [id]: { ...prev[id], settingsOpen: !prev[id].settingsOpen } }))
  const setIndicatorParam = (id, key, value) => setIndicators(prev => ({ ...prev, [id]: { ...prev[id], params: { ...prev[id].params, [key]: Number(value) || 0 } } }))
  const setStudyColor = (id, color) => setIndicators(prev => ({ ...prev, [id]: { ...prev[id], color } }))

  // ── Technical chart traces ─────────────────────────────────────────────────

  const { mainTraces, subplots, indicatorShapes } = useMemo(() => {
    if (!records.length) return { mainTraces: [], subplots: [], indicatorShapes: [] }
    const mains = [], subs = [], shps = []
    const extra = { ivData }
    Object.entries(indicators).forEach(([, state]) => {
      if (!state.enabled || !state.visible) return
      const template = STUDY_TEMPLATES.find(t => t.type === state.type)
      if (!template) return
      const result = template.compute(records, state.params, state.color, extra)
      mains.push(...result.mainTraces)
      if (result.subTraces.length) subs.push({ title: result.subTitle, traces: result.subTraces })
      if (result.shapes) shps.push(...result.shapes)
    })
    return { mainTraces: mains, subplots: subs, indicatorShapes: shps }
  }, [records, indicators, ivData])

  const { data: techData, layout: techLayout } = useMemo(() => {
    if (!records.length) return { data: [], layout: {} }
    const dates = records.map(r => r.date)
    const hasVolume = showVolume && records.some(r => r.volume > 0)
    const lowerCount = subplots.length + (hasVolume ? 1 : 0)
    const totalRows = 1 + lowerCount
    const priceWeight = 3, volWeight = 1, subWeight = 1
    const totalWeight = priceWeight + (hasVolume ? volWeight : 0) + subplots.length * subWeight
    const traces = []

    const chartLabel = ticker.trim().toUpperCase()
    const basePrice = records[0]?.close || 1
    const toPct = (v) => ((v - basePrice) / basePrice) * 100
    const isPct = chartScale === 'percent'

    if (isPct) {
      // Percentage mode — always line chart
      traces.push({ x: dates, y: records.map(r => toPct(r.close)), type: 'scatter', mode: 'lines', name: chartLabel, line: { color: '#2196F3', width: 2 }, xaxis: 'x', yaxis: 'y' })
    } else if (chartType === 'candlestick') {
      traces.push({ x: dates, open: records.map(r => r.open), high: records.map(r => r.high), low: records.map(r => r.low), close: records.map(r => r.close), type: 'candlestick', name: chartLabel, increasing: { line: { color: '#26A69A' } }, decreasing: { line: { color: '#EF5350' } }, xaxis: 'x', yaxis: 'y', hoverinfo: 'skip' })
      // Invisible scatter overlay for consistent OHLC hover on every bar
      traces.push({ x: dates, y: records.map(r => r.close), type: 'scatter', mode: 'markers', marker: { size: 0.1, color: 'rgba(0,0,0,0)' }, showlegend: false, hovertemplate: records.map(r => `<b>%{x|%a %b %d, %Y}</b><br>O: ${r.open?.toFixed(2)}<br>H: ${r.high?.toFixed(2)}<br>L: ${r.low?.toFixed(2)}<br>C: ${r.close?.toFixed(2)}<extra></extra>`), xaxis: 'x', yaxis: 'y' })
    } else {
      traces.push({ x: dates, y: records.map(r => r.close), type: 'scatter', mode: 'lines', name: chartLabel, line: { color: '#2196F3', width: 2 }, xaxis: 'x', yaxis: 'y' })
    }
    // Transform indicator overlays for percent mode
    mainTraces.forEach(t => {
      if (isPct && t.y) {
        traces.push({ ...t, y: t.y.map(v => v != null ? toPct(v) : null), xaxis: 'x', yaxis: 'y' })
      } else {
        traces.push({ ...t, xaxis: 'x', yaxis: 'y' })
      }
    })

    // Volume subplot
    let volAxisIdx = 2
    if (hasVolume) {
      const volumes = records.map(r => r.volume || 0)
      const volColors = records.map(r => r.close >= r.open ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)')
      traces.push({ x: dates, y: volumes, type: 'bar', name: 'Volume', marker: { color: volColors }, yaxis: `y${volAxisIdx}`, xaxis: 'x', showlegend: false })
      volAxisIdx++
    }

    // Lower indicator subplots
    subplots.forEach((sub, i) => {
      const axisIdx = hasVolume ? i + 3 : i + 2
      sub.traces.forEach(t => traces.push({ ...t, xaxis: 'x', yaxis: `y${axisIdx}` }))
    })

    const gap = 0.03, domains = []
    let cursor = 1
    const priceH = priceWeight / totalWeight
    domains.push([cursor - priceH + (totalRows > 1 ? gap / 2 : 0), cursor])
    cursor -= priceH
    if (hasVolume) {
      const h = volWeight / totalWeight
      const top = cursor, bottom = cursor - h
      domains.push([Math.max(0, bottom + gap / 2), top - gap / 2])
      cursor -= h
    }
    subplots.forEach((_, i) => {
      const h = subWeight / totalWeight, top = cursor
      const bottom = cursor - h + (i < subplots.length - 1 ? gap / 2 : 0)
      domains.push([Math.max(0, bottom), top - gap / 2])
      cursor -= h
    })

    // Compute axis expansion ranges
    const closes = records.map(r => r.close)
    const highs = records.map(r => r.high)
    const lows = records.map(r => r.low)
    const priceMin = Math.min(...(isPct ? closes.map(v => toPct(v)) : lows))
    const priceMax = Math.max(...(isPct ? closes.map(v => toPct(v)) : highs))
    const priceRange = priceMax - priceMin || 1
    const yPadTop = priceRange * (yExpandTopNum / 100)
    const yPadBot = priceRange * (yExpandBotNum / 100)

    // X-axis: extend range by N bars into the future
    const lastDate = dates[dates.length - 1]
    let xRange = undefined
    if (xExpandNum > 0 && lastDate) {
      // Estimate bar interval from last two dates
      const d1 = new Date(dates[Math.max(0, dates.length - 2)])
      const d2 = new Date(lastDate)
      const barMs = Math.max(d2 - d1, 86400000) // at least 1 day
      const futureDate = new Date(d2.getTime() + barMs * xExpandNum)
      xRange = [dates[0], futureDate.toISOString().slice(0, 10)]
    }

    // Build TOS-style x-axis ticks: month labels + spaced day numbers
    const xTickVals = []
    const xTickTexts = []
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    let prevMonth = null
    // Show day numbers spaced every N bars so they don't crowd
    const dayStep = dates.length > 300 ? 10 : dates.length > 120 ? 5 : dates.length > 60 ? 3 : 2
    // Pre-scan to find which indices are month boundaries so we can skip day ticks near them
    const monthBoundaries = new Set()
    for (let i = 0; i < dates.length; i++) {
      const mo = new Date(dates[i]).getMonth()
      if (i > 0 && mo !== new Date(dates[i - 1]).getMonth()) monthBoundaries.add(i)
    }
    const buf = Math.max(3, dayStep) // buffer zone around month labels
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i])
      const mo = d.getMonth()
      const day = d.getDate()
      if (mo !== prevMonth) {
        xTickVals.push(dates[i])
        xTickTexts.push(monthNames[mo])
        prevMonth = mo
      } else if (i % dayStep === 0) {
        // Skip day tick if it's too close (before or after) a month boundary
        let nearMonth = false
        for (const b of monthBoundaries) {
          if (Math.abs(i - b) <= buf) { nearMonth = true; break }
        }
        if (!nearMonth) {
          xTickVals.push(dates[i])
          xTickTexts.push(String(day))
        }
      }
    }

    const layout = {
      template: 'plotly_dark', paper_bgcolor: '#1e1e2f', plot_bgcolor: '#1e1e2f',
      font: { color: '#e0e0e0', size: 12 }, margin: { l: 60, r: 30, t: 40, b: 40 },
      height: 500 + lowerCount * 130,
      xaxis: { rangeslider: { visible: false }, type: 'date', gridcolor: '#333', hoverformat: '%a %b %d, %Y', tickvals: xTickVals, ticktext: xTickTexts, tickfont: { size: 9, color: '#aaa' }, tickangle: 0, showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot', ...(xRange ? { range: xRange } : {}) },
      yaxis: {
        title: isPct ? 'Change (%)' : 'Price',
        domain: domains[0], gridcolor: '#333',
        type: chartScale === 'log' ? 'log' : 'linear',
        ticksuffix: isPct ? '%' : '',
        range: chartScale !== 'log' ? [priceMin - yPadBot, priceMax + yPadTop] : undefined,
        showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot',
      },
      legend: { orientation: 'h', y: 1.08, x: 0.5, xanchor: 'center', font: { size: 11 } },
      hovermode: 'closest',
      newshape: { line: { color: drawColor, width: 2, dash: drawDash }, fillcolor: `${drawColor}26`, opacity: 0.8 },
      modebar: { orientation: 'v', bgcolor: 'rgba(30,30,47,0.8)', color: '#aaa', activecolor: '#FFD740' },
      dragmode: drawMode === 'trendline' ? 'drawline' : drawMode === 'hline' ? 'drawline' : drawMode === 'rect' ? 'drawrect' : drawMode === 'path' ? 'drawopenpath' : 'zoom',
    }
    if (hasVolume) {
      layout.yaxis2 = { title: 'Volume', domain: domains[1], gridcolor: '#333', showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot' }
    }
    subplots.forEach((sub, i) => {
      const domainIdx = hasVolume ? i + 2 : i + 1
      const axisIdx = hasVolume ? i + 3 : i + 2
      layout[`yaxis${axisIdx}`] = { title: sub.title, domain: domains[domainIdx], gridcolor: '#333', showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot' }
    })
    const fibShapes = fibSets.flatMap(f => f.shapes)
    const fibAnnotations = fibSets.flatMap(f => f.annotations)
    layout.shapes = [...drawnShapes, ...indicatorShapes, ...fibShapes]
    if (fibAnnotations.length) layout.annotations = [...(layout.annotations || []), ...fibAnnotations]
    return { data: traces, layout }
  }, [records, chartType, chartScale, yExpandTopNum, yExpandBotNum, xExpandNum, tickerName, mainTraces, subplots, showVolume, indicatorShapes, drawColor, drawDash, drawMode, drawnShapes, fibSets])

  // ── Return chart traces ────────────────────────────────────────────────────

  const { data: returnPlotData, layout: returnPlotLayout } = useMemo(() => {
    if (!returnData?.series) return { data: [], layout: {} }
    const traces = []
    const annotations = []
    const allSymbols = Object.keys(returnData.series)
    // Comparison ticker colors — cycling distinct hues
    const compColors = ['#a0f0c0', '#FFD700', '#ff7eb3', '#b39ddb', '#ff8a65', '#4dd0e1', '#aed581', '#f48fb1']
    const compDashes = ['solid', 'dash', 'dot', 'dashdot', 'longdash']

    allSymbols.forEach((sym, si) => {
      const { dates, traces: traceMap } = returnData.series[sym]
      const isPrimary = si === 0

      Object.entries(traceMap).forEach(([key, values]) => {
        const style = TRACE_STYLES[key] || { dash: 'solid', color: '#7ecfff', width: 2.5, label: key }

        let color, dash, width, name
        if (isPrimary || allSymbols.length === 1) {
          // Primary ticker: use web-style blue with dash pattern per trace type
          color = style.color
          dash = style.dash
          width = style.width
          if (key === 'blend') {
            name = `${sym} (${returnData.reinvest_pct}%)`
          } else if (key === 'drip') {
            name = `${sym} (100% DRIP)`
          } else if (key === 'price') {
            name = `${sym} (Price)`
          } else if (key === 'pricediv') {
            name = `${sym} (Price+Div)`
          } else {
            name = `${sym} (${style.label})`
          }
        } else {
          // Comparison tickers: distinct color per ticker, dash per trace type
          color = compColors[(si - 1) % compColors.length]
          dash = style.dash  // keep trace-type dash
          width = style.width
          name = `${sym} (${key === 'blend' ? returnData.reinvest_pct + '%' : style.label || key})`
        }

        traces.push({
          x: dates, y: values, type: 'scatter', mode: 'lines', name,
          line: { color, dash, width },
        })

        // End-of-line return % annotation
        if (values.length > 0) {
          const lastVal = values[values.length - 1]
          const retNum = lastVal - 100
          const retPct = retNum.toFixed(2)
          annotations.push({
            x: dates[dates.length - 1],
            _yRaw: lastVal,
            text: `${retNum >= 0 ? '+' : ''}${retPct}%`,
            showarrow: false,
            xanchor: 'left',
            xshift: 8,
            font: { color, size: 11, family: 'monospace' },
          })
        }
      })
    })

    // Baseline reference at 100
    if (traces.length) {
      const allDates = Object.values(returnData.series).flatMap(s => s.dates)
      const minDate = allDates.reduce((a, b) => a < b ? a : b)
      const maxDate = allDates.reduce((a, b) => a > b ? a : b)
      traces.push({
        x: [minDate, maxDate], y: [100, 100], type: 'scatter', mode: 'lines',
        name: 'Baseline', line: { color: '#555', dash: 'dash', width: 1 }, showlegend: false,
      })
    }

    // Build title like web version
    const modeInfo = RETURN_MODES.find(m => m.value === returnData.mode) || {}
    const periodLabel = PERIODS.find(p => p.value === period)?.label || period
    let titleText = `${ticker.toUpperCase()} — ${periodLabel}`
    if (returnData.mode === 'all3') {
      titleText += ` — Price vs Custom vs DRIP (${returnData.reinvest_pct}% reinvest)`
    } else if (returnData.mode === 'all4') {
      titleText += ` — Price vs Custom vs DRIP (${returnData.reinvest_pct}% reinvest)`
    } else if (returnData.mode === 'both') {
      titleText += ` — Total Return & Price (${returnData.reinvest_pct}% reinvest)`
    } else {
      titleText += ` — ${modeInfo.label || returnData.mode}`
      if (returnData.mode === 'total') titleText += ` (${returnData.reinvest_pct}% reinvest)`
    }

    // De-overlap annotations: sort by Y, push apart so labels don't collide
    // Each label needs ~16px clearance; chart plot area is ~420px (500 - margins)
    if (annotations.length > 1) {
      const allY = Object.values(returnData.series).flatMap(s =>
        Object.values(s.traces).flat()
      )
      const yMin = Math.min(...allY), yMax = Math.max(...allY)
      const yRange = yMax - yMin || 1
      const pxPerUnit = 420 / yRange
      const minGap = Math.max(18 / pxPerUnit, yRange * 0.04)  // at least 18px worth of Y units
      annotations.sort((a, b) => a._yRaw - b._yRaw)
      // Multiple passes to resolve cascading overlaps
      for (let pass = 0; pass < 10; pass++) {
        let moved = false
        for (let i = 1; i < annotations.length; i++) {
          const prev = annotations[i - 1]
          const curr = annotations[i]
          const gap = curr._yRaw - prev._yRaw
          if (gap < minGap) {
            const shift = (minGap - gap) / 2 + 0.05
            prev._yRaw -= shift
            curr._yRaw += shift
            moved = true
          }
        }
        if (!moved) break
      }
    }
    annotations.forEach(a => { a.y = a._yRaw; delete a._yRaw })

    const layout = {
      template: 'plotly_dark', paper_bgcolor: '#1e1e2f', plot_bgcolor: '#1e1e2f',
      font: { color: '#e0e0e0', size: 12 },
      margin: { l: 60, r: 90, t: 50, b: 40 },
      height: 500,
      title: { text: titleText, font: { size: 14, color: '#e0e0e0' } },
      xaxis: { type: 'date', gridcolor: '#333', showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot' },
      yaxis: { title: 'Normalized Return (100 = start)', gridcolor: '#333', showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot' },
      legend: { orientation: 'h', y: 1.06, x: 0.5, xanchor: 'center', font: { size: 11 } },
      hovermode: 'closest',
      annotations,
    }
    return { data: traces, layout }
  }, [returnData, ticker, period])


  const sliderDisabled = returnMode === 'price' || returnMode === 'pricediv'

  return (
    <div className="page etf-screen">
      <h2>Stock and ETF Analysis</h2>

      {/* Tab bar */}
      <div className="etf-tabs">
        <button className={`btn btn-sm${tab === 'technical' ? ' btn-active' : ''}`} onClick={() => setTab('technical')}>Technical</button>
        <button className={`btn btn-sm${tab === 'returns' ? ' btn-active' : ''}`} onClick={() => setTab('returns')}>Returns</button>
      </div>

      {/* Controls bar */}
      <div className="etf-controls">
        <div className="etf-ticker-input">
          <select value="" onChange={e => setTicker(e.target.value)} title="Pick from portfolio">
            <option value="">Portfolio...</option>
            {portfolioTickers.map(t => (
              <option key={t.ticker} value={t.ticker}>{t.ticker} — {t.description}</option>
            ))}
          </select>
          <input type="text" placeholder="Ticker (e.g. SPY)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} onKeyDown={handleKeyDown} />
          <button className="btn btn-primary" onClick={loadChart} disabled={isLoading || !canLoad}>
            {isLoading ? 'Loading...' : 'Load'}
          </button>
          {compareTickers.map((s, i) => (
            <span key={s} className="compare-chip" style={{ background: CHIP_COLORS[i % CHIP_COLORS.length], color: '#111' }}>
              {s} <button onClick={() => removeCompare(s)}>&times;</button>
            </span>
          ))}
        </div>

        <div className="etf-period-bar">
          {PERIODS.map(p => (
            <button key={p.value} className={`btn btn-sm${period === p.value && !interval ? ' btn-active' : ''}`} onClick={() => { setPeriod(p.value); setInterval_(''); setDrawnShapes([]); setFibSets([]); setFibClicks([]) }}>{p.label}</button>
          ))}
          <span className="etf-draw-sep">|</span>
          {tab === 'technical' && (
            <select className="etf-draw-select" value={period === '1d' || period === '5d' ? `${period}|${interval}` : ''} onChange={e => {
              if (!e.target.value) return
              const [p, i] = e.target.value.split('|')
              setPeriod(p); setInterval_(i); setDrawnShapes([]); setFibSets([]); setFibClicks([])
            }}>
              <option value="">Intraday</option>
              <option value="1d|1m">1 Day / 1min</option>
              <option value="1d|2m">1 Day / 2min</option>
              <option value="1d|5m">1 Day / 5min</option>
              <option value="1d|15m">1 Day / 15min</option>
              <option value="1d|30m">1 Day / 30min</option>
              <option value="1d|60m">1 Day / 1hr</option>
              <option value="5d|1m">5 Day / 1min</option>
              <option value="5d|5m">5 Day / 5min</option>
              <option value="5d|15m">5 Day / 15min</option>
              <option value="5d|30m">5 Day / 30min</option>
              <option value="5d|60m">5 Day / 1hr</option>
            </select>
          )}
          <select className="etf-draw-select" value={interval === '1d' ? `${period}|${interval}` : ''} onChange={e => {
            if (!e.target.value) return
            const [p, i] = e.target.value.split('|')
            setPeriod(p); setInterval_(i); setDrawnShapes([]); setFibSets([]); setFibClicks([])
          }}>
            <option value="">Daily</option>
            <option value="1mo|1d">1 Month / Daily</option>
            <option value="3mo|1d">3 Month / Daily</option>
            <option value="6mo|1d">6 Month / Daily</option>
            <option value="9mo|1d">9 Month / Daily</option>
            <option value="ytd|1d">YTD / Daily</option>
            <option value="1y|1d">1 Year / Daily</option>
            <option value="2y|1d">2 Year / Daily</option>
            <option value="5y|1d">5 Year / Daily</option>
            <option value="10y|1d">10 Year / Daily</option>
            <option value="max|1d">Max / Daily</option>
          </select>
          <select className="etf-draw-select" value={interval === '1wk' || interval === '1mo' || interval === '3mo' ? `${period}|${interval}` : ''} onChange={e => {
            if (!e.target.value) return
            const [p, i] = e.target.value.split('|')
            setPeriod(p); setInterval_(i); setDrawnShapes([]); setFibSets([]); setFibClicks([])
          }}>
            <option value="">Weekly/Monthly</option>
            <option value="3mo|1wk">3 Month / Weekly</option>
            <option value="6mo|1wk">6 Month / Weekly</option>
            <option value="1y|1wk">1 Year / Weekly</option>
            <option value="2y|1wk">2 Year / Weekly</option>
            <option value="5y|1wk">5 Year / Weekly</option>
            <option value="10y|1wk">10 Year / Weekly</option>
            <option value="max|1wk">Max / Weekly</option>
            <option value="1y|1mo">1 Year / Monthly</option>
            <option value="2y|1mo">2 Year / Monthly</option>
            <option value="5y|1mo">5 Year / Monthly</option>
            <option value="10y|1mo">10 Year / Monthly</option>
            <option value="max|1mo">Max / Monthly</option>
            <option value="max|3mo">Max / Quarterly</option>
          </select>
        </div>

        {tab === 'technical' && (
          <div className="etf-chart-toggle">
            <button className={`btn btn-sm${chartType === 'line' ? ' btn-active' : ''}`} onClick={() => setChartType('line')}>Line</button>
            <button className={`btn btn-sm${chartType === 'candlestick' ? ' btn-active' : ''}`} onClick={() => setChartType('candlestick')}>Candle</button>
            <button className={`btn btn-sm${showVolume ? ' btn-active' : ''}`} onClick={() => setShowVolume(v => !v)}>Vol</button>
            <span className="etf-draw-sep">|</span>
            <button className={`btn btn-sm${chartScale === 'linear' ? ' btn-active' : ''}`} onClick={() => setChartScale('linear')}>Linear</button>
            <button className={`btn btn-sm${chartScale === 'log' ? ' btn-active' : ''}`} onClick={() => setChartScale('log')}>Log</button>
            <button className={`btn btn-sm${chartScale === 'percent' ? ' btn-active' : ''}`} onClick={() => setChartScale('percent')}>%</button>
            <span className="etf-draw-sep">|</span>
            <label style={{ fontSize: '0.75rem', color: '#aaa', marginRight: 2 }}>Y↑</label>
            <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
              <input className="etf-draw-select" value={yExpandTop}
                style={{ width: 62, textAlign: 'center', paddingRight: 18 }}
                onChange={e => setYExpandTop(e.target.value)}
                onBlur={e => { const v = parseInt(e.target.value); if (isNaN(v) || v < 0) setYExpandTop('10') }}
                title="Top price axis expansion %" />
              <select className="etf-draw-select"
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, opacity: 0, cursor: 'pointer' }}
                value="" onChange={e => { if (e.target.value) setYExpandTop(e.target.value) }}>
                <option value="">▼</option>
                <option value="0">0%</option>
                <option value="10">10%</option>
                <option value="20">20%</option>
                <option value="30">30%</option>
                <option value="50">50%</option>
              </select>
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: '0.6rem', color: '#666', pointerEvents: 'none' }}>▼</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#666', marginLeft: 2, marginRight: 2 }}>%</span>
            <label style={{ fontSize: '0.75rem', color: '#aaa', marginRight: 2 }}>Y↓</label>
            <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
              <input className="etf-draw-select" value={yExpandBot}
                style={{ width: 62, textAlign: 'center', paddingRight: 18 }}
                onChange={e => setYExpandBot(e.target.value)}
                onBlur={e => { const v = parseInt(e.target.value); if (isNaN(v) || v < 0) setYExpandBot('10') }}
                title="Bottom price axis expansion %" />
              <select className="etf-draw-select"
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, opacity: 0, cursor: 'pointer' }}
                value="" onChange={e => { if (e.target.value) setYExpandBot(e.target.value) }}>
                <option value="">▼</option>
                <option value="0">0%</option>
                <option value="10">10%</option>
                <option value="20">20%</option>
                <option value="30">30%</option>
                <option value="50">50%</option>
              </select>
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: '0.6rem', color: '#666', pointerEvents: 'none' }}>▼</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#666', marginLeft: 2, marginRight: 4 }}>%</span>
            <label style={{ fontSize: '0.75rem', color: '#aaa', marginRight: 2 }}>X→</label>
            <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
              <input className="etf-draw-select" value={xExpand}
                style={{ width: 62, textAlign: 'center', paddingRight: 18 }}
                onChange={e => setXExpand(e.target.value)}
                onBlur={e => { const v = parseInt(e.target.value); if (isNaN(v) || v < 0) setXExpand('0') }}
                title="Bars to extend right" />
              <select className="etf-draw-select"
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, opacity: 0, cursor: 'pointer' }}
                value="" onChange={e => { if (e.target.value) setXExpand(e.target.value) }}>
                <option value="">▼</option>
                <option value="0">0</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="500">500</option>
              </select>
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: '0.6rem', color: '#666', pointerEvents: 'none' }}>▼</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#666', marginLeft: 2, marginRight: 4 }}>bars</span>
            <span className="etf-draw-sep">|</span>
            <button className={`btn btn-sm${drawMode === 'trendline' ? ' btn-active' : ''}`} onClick={() => setDrawMode(m => m === 'trendline' ? null : 'trendline')}>Trendline</button>
            <button className={`btn btn-sm${drawMode === 'hline' ? ' btn-active' : ''}`} onClick={() => setDrawMode(m => m === 'hline' ? null : 'hline')}>H-Line</button>
            <button className={`btn btn-sm${drawMode === 'rect' ? ' btn-active' : ''}`} onClick={() => setDrawMode(m => m === 'rect' ? null : 'rect')}>Rect</button>
            <button className={`btn btn-sm${drawMode === 'path' ? ' btn-active' : ''}`} onClick={() => setDrawMode(m => m === 'path' ? null : 'path')}>Path</button>
            <button className={`btn btn-sm${drawMode === 'fib' ? ' btn-active' : ''}`} onClick={() => { setDrawMode(m => m === 'fib' ? null : 'fib'); setFibClicks([]) }}>Fib</button>
            <select className="etf-draw-select" value={drawDash} onChange={e => setDrawDash(e.target.value)}>
              <option value="solid">Solid</option>
              <option value="dash">Dash</option>
              <option value="dot">Dot</option>
            </select>
            <input type="color" className="etf-draw-color" value={drawColor} onChange={e => setDrawColor(e.target.value)} title="Line Color" />
            <button className="btn btn-sm btn-danger" onClick={() => { setDrawnShapes([]); setFibSets([]); setFibClicks([]); setDrawMode(null) }}>Clear All</button>
          </div>
        )}
      </div>

      {/* Returns-only controls */}
      {tab === 'returns' && (
        <div className="etf-return-controls">
          <div className="etf-mode-bar">
            {RETURN_MODES.map(m => (
              <button key={m.value} className={`btn btn-sm${returnMode === m.value ? ' btn-active' : ''}`} onClick={() => setReturnMode(m.value)} title={m.desc}>{m.label}</button>
            ))}
          </div>

          <div className="etf-reinvest">
            <label>Reinvest: <strong>{reinvest}%</strong></label>
            <input type="range" min={0} max={100} value={reinvest} onChange={e => setReinvest(Number(e.target.value))} disabled={sliderDisabled} />
            <input type="number" min={0} max={100} value={reinvest} onChange={e => setReinvest(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} disabled={sliderDisabled} className="reinvest-num" />
          </div>

          <div className="etf-compare">
            <select value="" onChange={e => {
              const s = e.target.value.toUpperCase()
              if (s && s !== ticker.toUpperCase() && !compareTickers.includes(s)) setCompareTickers(prev => [...prev, s])
            }}>
              <option value="">Add from portfolio...</option>
              {portfolioTickers.filter(t => t.ticker !== ticker.toUpperCase() && !compareTickers.includes(t.ticker)).map(t => (
                <option key={t.ticker} value={t.ticker}>{t.ticker} — {t.description}</option>
              ))}
            </select>
            <input type="text" placeholder="Or type ticker..." value={compareInput} onChange={e => setCompareInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') addCompare() }} />
            <button className="btn btn-sm" onClick={addCompare}>Add</button>
            {compareTickers.map((s, i) => (
              <span key={s} className="compare-chip" style={{ background: CHIP_COLORS[i % CHIP_COLORS.length], color: '#111' }}>
                {s} <button onClick={() => removeCompare(s)}>&times;</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <div className="etf-error">{error}</div>}

      <div className="etf-body">
        {/* Sidebar: TOS-style studies (technical) or stats (returns) */}
        <aside className="etf-indicators">
          {tab === 'technical' ? (
            <>
              {/* Added Studies panel */}
              <h3>Added Studies</h3>
              {(() => {
                const added = Object.entries(indicators)
                  .filter(([, s]) => s.enabled)
                  .map(([id, s]) => ({ id, ...s, template: STUDY_TEMPLATES.find(t => t.type === s.type) }))
                  .filter(s => s.template)
                const priceStudies = added.filter(s => s.template.panel === 'price')
                const lowerStudies = added.filter(s => s.template.panel === 'lower')

                const renderStudy = (study) => {
                  const { id, template, params, visible, settingsOpen, color } = study
                  const paramStr = template.paramFields.length
                    ? ' (' + template.paramFields.map(f => params[f.key]).join(', ') + ')'
                    : ''
                  return (
                    <div key={id} className="tos-study-row">
                      <div className="tos-study-header">
                        {color && <span className="tos-study-swatch" style={{ background: color }} />}
                        <span className="tos-study-name" onClick={() => template.paramFields.length > 0 && toggleSettings(id)} style={template.paramFields.length > 0 ? { cursor: 'pointer' } : {}}>{template.label}{paramStr}</span>
                        <div className="tos-study-actions">
                          <button
                            className={`tos-btn-icon${visible ? '' : ' tos-hidden'}`}
                            onClick={() => toggleVisibility(id)}
                            title={visible ? 'Hide' : 'Show'}
                          >
                            {visible ? '\u{1F441}' : '\u{1F441}\u{200D}\u{1F5E8}'}
                          </button>
                          <button className="tos-btn-icon tos-btn-remove" onClick={() => removeStudy(id)} title="Remove">&times;</button>
                        </div>
                      </div>
                      {settingsOpen && (template.paramFields.length > 0 || color) && (
                        <div className="tos-study-settings">
                          {template.paramFields.map(f => (
                            <label key={f.key} className="param-field">
                              <span>{f.label}</span>
                              <input type="number" min={f.min} max={f.max} value={params[f.key]} onChange={e => setIndicatorParam(id, f.key, e.target.value)} />
                            </label>
                          ))}
                          {color && (
                            <label className="param-field">
                              <span>Color</span>
                              <input type="color" value={color} onChange={e => setStudyColor(id, e.target.value)} className="tos-color-picker" />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  )
                }

                return added.length === 0 ? (
                  <p className="sidebar-hint">No studies added. Use the list below to add.</p>
                ) : (
                  <>
                    {priceStudies.length > 0 && (
                      <div className="tos-panel-section">
                        <div className="tos-panel-label">Price</div>
                        {priceStudies.map(renderStudy)}
                      </div>
                    )}
                    {lowerStudies.length > 0 && (
                      <div className="tos-panel-section">
                        <div className="tos-panel-label">Lower</div>
                        {lowerStudies.map(renderStudy)}
                      </div>
                    )}
                  </>
                )
              })()}

              {/* Available Studies list */}
              <div className="tos-available">
                <button className="tos-toggle-available" onClick={() => setStudiesPanelOpen(o => !o)}>
                  {studiesPanelOpen ? '\u25B4' : '\u25BE'} Available Studies
                </button>
                {studiesPanelOpen && (
                  <div className="tos-study-list">
                    <input
                      type="text"
                      className="tos-search"
                      placeholder="Search studies..."
                      value={studySearch}
                      onChange={e => setStudySearch(e.target.value)}
                    />
                    {STUDY_TEMPLATES
                      .filter(t => {
                        if (t.multi) return true
                        return !Object.values(indicators).some(s => s.type === t.type && s.enabled)
                      })
                      .filter(t => !studySearch || t.label.toLowerCase().includes(studySearch.toLowerCase()))
                      .map(t => (
                        <div key={t.type} className="tos-available-item" onClick={() => addStudy(t.type)}>
                          {t.label}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <h3>Statistics</h3>
              {returnData?.stats && Object.entries(returnData.stats).map(([sym, st]) => (
                <div key={sym} className="stat-card">
                  <h4>{sym}</h4>
                  <div className="stat-row"><span>Total Return</span><span style={{ color: pctColor(st.total_ret) }}>{pct(st.total_ret)}</span></div>
                  <div className="stat-row"><span>Price Return</span><span style={{ color: pctColor(st.price_ret) }}>{pct(st.price_ret)}</span></div>
                  <div className="stat-row"><span>Div Contrib</span><span style={{ color: pctColor(st.div_contrib) }}>{pct(st.div_contrib)}</span></div>
                  <div className="stat-row"><span>Annualised</span><span style={{ color: st.annualized != null ? pctColor(st.annualized) : '#888' }}>{pct(st.annualized)}</span></div>
                  <div className="stat-row"><span>Max Drawdown</span><span style={{ color: '#ef5350' }}>{pct(st.max_drawdown)}</span></div>
                </div>
              ))}
              {returnData?.warnings?.length > 0 && (
                <div className="stat-warnings">
                  {returnData.warnings.map((w, i) => <div key={i} className="stat-warning">{w}</div>)}
                </div>
              )}
              {!returnData && <p className="sidebar-hint">Load a ticker to see return statistics.</p>}
            </>
          )}
        </aside>

        {/* Chart area */}
        <div className="etf-chart-area">
          {/* Summary cards strip (Returns tab) */}
          {tab === 'returns' && returnData?.stats && (() => {
            const primarySym = Object.keys(returnData.stats)[0]
            const st = returnData.stats[primarySym]
            if (!st) return null
            const periodLabel = PERIODS.find(p => p.value === period)?.label || period
            return (
              <div className="return-summary-strip">
                <div className="return-summary-card">
                  <div className="rsc-label">PERIOD</div>
                  <div className="rsc-value" style={{ color: '#90caf9' }}>{periodLabel}</div>
                </div>
                <div className="return-summary-card">
                  <div className="rsc-label">{primarySym} RETURN</div>
                  <div className="rsc-value" style={{ color: pctColor(st.total_ret) }}>{pct(st.total_ret)}</div>
                  <div className="rsc-sub">{returnData.mode === 'price' ? 'price only' : returnData.reinvest_pct + '% DRIP'}</div>
                </div>
                <div className="return-summary-card">
                  <div className="rsc-label">{primarySym} PRICE</div>
                  <div className="rsc-value" style={{ color: pctColor(st.price_ret) }}>{pct(st.price_ret)}</div>
                  <div className="rsc-sub">price only (dotted)</div>
                </div>
                <div className="return-summary-card">
                  <div className="rsc-label">{primarySym} DIV</div>
                  <div className="rsc-value" style={{ color: pctColor(st.div_contrib) }}>{pct(st.div_contrib)}</div>
                  <div className="rsc-sub">dividend portion</div>
                </div>
                <div className="return-summary-card">
                  <div className="rsc-label">{primarySym} ANN.</div>
                  <div className="rsc-value" style={{ color: st.annualized != null ? pctColor(st.annualized) : '#888' }}>{pct(st.annualized)}</div>
                  <div className="rsc-sub">annualized</div>
                </div>
                <div className="return-summary-card">
                  <div className="rsc-label">{primarySym} MAX DD</div>
                  <div className="rsc-value" style={{ color: '#ef5350' }}>{pct(st.max_drawdown)}</div>
                  <div className="rsc-sub">max drawdown</div>
                </div>
              </div>
            )
          })()}

          {tab === 'technical' ? (
            records.length > 0 ? (
              <div ref={plotRef}>
                <div className="etf-chart-title">{ticker.trim().toUpperCase()}{tickerName && tickerName !== ticker.trim().toUpperCase() ? ` — ${tickerName}` : ''}</div>
                {drawMode === 'fib' && (
                  <div style={{ color: '#FFD740', fontSize: '0.8rem', padding: '4px 8px', background: '#2a2a3d', borderRadius: 4, marginBottom: 4 }}>
                    {fibClicks.length === 0 ? 'Click the first point (swing high or low)' : 'Click the second point to complete Fibonacci retracement'}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <Plot data={techData} layout={techLayout} config={{
                    responsive: true, displayModeBar: true, displaylogo: false,
                    modeBarButtonsToAdd: ['eraseshape'],
                  }} useResizeHandler style={{ width: '100%' }}
                  onRelayout={(e) => {
                    if (e.shapes) {
                      setDrawnShapes(e.shapes.filter(s => !indicatorShapes.includes(s)))
                    } else if (e['shapes[0]'] !== undefined || Object.keys(e).some(k => k.startsWith('shapes['))) {
                      const plotEl = plotRef.current?.querySelector('.js-plotly-plot')
                      if (plotEl && plotEl._fullLayout && plotEl._fullLayout.shapes) {
                        const allShapes = plotEl._fullLayout.shapes.map(s => ({
                          type: s.type, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1,
                          xref: s.xref, yref: s.yref,
                          line: { color: s.line?.color, width: s.line?.width, dash: s.line?.dash },
                          fillcolor: s.fillcolor, opacity: s.opacity, path: s.path,
                        }))
                        setDrawnShapes(allShapes.filter(s => !indicatorShapes.some(is => is.x0 === s.x0 && is.y0 === s.y0 && is.x1 === s.x1 && is.y1 === s.y1)))
                      }
                    }
                  }} />
                  {(drawMode === 'fib' || drawMode === 'hline') && (
                    <div
                      onClick={handleOverlayClick}
                      style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        cursor: 'crosshair', zIndex: 10,
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              !loading && <div className="etf-placeholder">Enter a ticker and click Load to view the chart.</div>
            )
          ) : (
            returnData?.series ? (
              <Plot data={returnPlotData} layout={returnPlotLayout} config={{ responsive: true, displayModeBar: true, displaylogo: false }} useResizeHandler style={{ width: '100%' }} />
            ) : (
              !returnLoading && <div className="etf-placeholder">Select a return mode and click Load to compare returns.</div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

import React, { useState, useMemo, useCallback } from 'react'
import { API_BASE } from '../config'
import { useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyWhole } from '../utils/money'

// ── Default 2025 Federal Income Tax Brackets ──────────────────────

const DEFAULT_FED_BRACKETS = {
  single: [
    { max: 11925, rate: 0.10 },
    { max: 48475, rate: 0.12 },
    { max: 103350, rate: 0.22 },
    { max: 197300, rate: 0.24 },
    { max: 252525, rate: 0.32 },
    { max: 626350, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  mfj: [
    { max: 23850, rate: 0.10 },
    { max: 96950, rate: 0.12 },
    { max: 206700, rate: 0.22 },
    { max: 394600, rate: 0.24 },
    { max: 505050, rate: 0.32 },
    { max: 752800, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
}

const DEFAULT_FED_LTCG = {
  single: [
    { max: 48350, rate: 0 },
    { max: 533400, rate: 0.15 },
    { max: Infinity, rate: 0.20 },
  ],
  mfj: [
    { max: 96700, rate: 0 },
    { max: 600050, rate: 0.15 },
    { max: Infinity, rate: 0.20 },
  ],
}

// ── Default 2025 State Tax Data ───────────────────────────────────

const DEFAULT_STATE_TAX = {
  AK: 0,
  AL: { single: [{ max: 500, rate: 0.02 }, { max: 3000, rate: 0.04 }, { max: Infinity, rate: 0.05 }], mfj: [{ max: 1000, rate: 0.02 }, { max: 6000, rate: 0.04 }, { max: Infinity, rate: 0.05 }] },
  AR: { single: [{ max: 4500, rate: 0.02 }, { max: Infinity, rate: 0.039 }], mfj: [{ max: 4500, rate: 0.02 }, { max: Infinity, rate: 0.039 }] },
  AZ: 0.025,
  CA: { single: [{ max: 10756, rate: 0.01 }, { max: 25499, rate: 0.02 }, { max: 40245, rate: 0.04 }, { max: 55866, rate: 0.06 }, { max: 70606, rate: 0.08 }, { max: 360659, rate: 0.093 }, { max: 432787, rate: 0.103 }, { max: 721314, rate: 0.113 }, { max: 1000000, rate: 0.123 }, { max: Infinity, rate: 0.133 }], mfj: [{ max: 21512, rate: 0.01 }, { max: 50998, rate: 0.02 }, { max: 80490, rate: 0.04 }, { max: 111732, rate: 0.06 }, { max: 141732, rate: 0.08 }, { max: 721318, rate: 0.093 }, { max: 865574, rate: 0.103 }, { max: 1000000, rate: 0.113 }, { max: 1442628, rate: 0.123 }, { max: Infinity, rate: 0.133 }] },
  CO: 0.044,
  CT: { single: [{ max: 10000, rate: 0.02 }, { max: 50000, rate: 0.045 }, { max: 100000, rate: 0.055 }, { max: 200000, rate: 0.06 }, { max: 250000, rate: 0.065 }, { max: 500000, rate: 0.069 }, { max: Infinity, rate: 0.0699 }], mfj: [{ max: 20000, rate: 0.02 }, { max: 100000, rate: 0.045 }, { max: 200000, rate: 0.055 }, { max: 400000, rate: 0.06 }, { max: 500000, rate: 0.065 }, { max: 1000000, rate: 0.069 }, { max: Infinity, rate: 0.0699 }] },
  DE: { single: [{ max: 5000, rate: 0.022 }, { max: 10000, rate: 0.039 }, { max: 20000, rate: 0.048 }, { max: 25000, rate: 0.052 }, { max: 60000, rate: 0.0555 }, { max: Infinity, rate: 0.066 }], mfj: [{ max: 5000, rate: 0.022 }, { max: 10000, rate: 0.039 }, { max: 20000, rate: 0.048 }, { max: 25000, rate: 0.052 }, { max: 60000, rate: 0.0555 }, { max: Infinity, rate: 0.066 }] },
  FL: 0,
  GA: 0.0539,
  HI: { single: [{ max: 9600, rate: 0.014 }, { max: 14400, rate: 0.032 }, { max: 19200, rate: 0.055 }, { max: 24000, rate: 0.064 }, { max: 36000, rate: 0.068 }, { max: 48000, rate: 0.072 }, { max: 125000, rate: 0.076 }, { max: 175000, rate: 0.079 }, { max: 225000, rate: 0.0825 }, { max: 275000, rate: 0.09 }, { max: 325000, rate: 0.1 }, { max: Infinity, rate: 0.11 }], mfj: [{ max: 19200, rate: 0.014 }, { max: 28800, rate: 0.032 }, { max: 38400, rate: 0.055 }, { max: 48000, rate: 0.064 }, { max: 72000, rate: 0.068 }, { max: 96000, rate: 0.072 }, { max: 250000, rate: 0.076 }, { max: 350000, rate: 0.079 }, { max: 450000, rate: 0.0825 }, { max: 550000, rate: 0.09 }, { max: 650000, rate: 0.1 }, { max: Infinity, rate: 0.11 }] },
  IA: 0.038,
  ID: 0.05695,
  IL: 0.0495,
  IN: 0.03,
  KS: { single: [{ max: 23000, rate: 0.052 }, { max: Infinity, rate: 0.0558 }], mfj: [{ max: 46000, rate: 0.052 }, { max: Infinity, rate: 0.0558 }] },
  KY: 0.04,
  LA: 0.03,
  MA: { single: [{ max: 1083150, rate: 0.05 }, { max: Infinity, rate: 0.09 }], mfj: [{ max: 1083150, rate: 0.05 }, { max: Infinity, rate: 0.09 }] },
  MD: { single: [{ max: 1000, rate: 0.02 }, { max: 2000, rate: 0.03 }, { max: 3000, rate: 0.04 }, { max: 100000, rate: 0.0475 }, { max: 125000, rate: 0.05 }, { max: 150000, rate: 0.0525 }, { max: 250000, rate: 0.055 }, { max: Infinity, rate: 0.0575 }], mfj: [{ max: 1000, rate: 0.02 }, { max: 2000, rate: 0.03 }, { max: 3000, rate: 0.04 }, { max: 150000, rate: 0.0475 }, { max: 175000, rate: 0.05 }, { max: 225000, rate: 0.0525 }, { max: 300000, rate: 0.055 }, { max: Infinity, rate: 0.0575 }] },
  ME: { single: [{ max: 26800, rate: 0.058 }, { max: 63450, rate: 0.0675 }, { max: Infinity, rate: 0.0715 }], mfj: [{ max: 53600, rate: 0.058 }, { max: 126900, rate: 0.0675 }, { max: Infinity, rate: 0.0715 }] },
  MI: 0.0425,
  MN: { single: [{ max: 32570, rate: 0.0535 }, { max: 106990, rate: 0.068 }, { max: 198630, rate: 0.0785 }, { max: Infinity, rate: 0.0985 }], mfj: [{ max: 47620, rate: 0.0535 }, { max: 189180, rate: 0.068 }, { max: 330410, rate: 0.0785 }, { max: Infinity, rate: 0.0985 }] },
  MO: { single: [{ max: 2626, rate: 0.02 }, { max: 3939, rate: 0.025 }, { max: 5252, rate: 0.03 }, { max: 6565, rate: 0.035 }, { max: 7878, rate: 0.04 }, { max: 9191, rate: 0.045 }, { max: Infinity, rate: 0.047 }], mfj: [{ max: 2626, rate: 0.02 }, { max: 3939, rate: 0.025 }, { max: 5252, rate: 0.03 }, { max: 6565, rate: 0.035 }, { max: 7878, rate: 0.04 }, { max: 9191, rate: 0.045 }, { max: Infinity, rate: 0.047 }] },
  MS: 0.044,
  MT: { single: [{ max: 21100, rate: 0.047 }, { max: Infinity, rate: 0.059 }], mfj: [{ max: 42200, rate: 0.047 }, { max: Infinity, rate: 0.059 }] },
  NC: 0.0425,
  ND: { single: [{ max: 244825, rate: 0.0195 }, { max: Infinity, rate: 0.025 }], mfj: [{ max: 298075, rate: 0.0195 }, { max: Infinity, rate: 0.025 }] },
  NE: { single: [{ max: 4030, rate: 0.0246 }, { max: 24120, rate: 0.0351 }, { max: 38870, rate: 0.0501 }, { max: Infinity, rate: 0.052 }], mfj: [{ max: 8040, rate: 0.0246 }, { max: 48250, rate: 0.0351 }, { max: 77730, rate: 0.0501 }, { max: Infinity, rate: 0.052 }] },
  NH: 0,
  NJ: { single: [{ max: 20000, rate: 0.014 }, { max: 35000, rate: 0.0175 }, { max: 40000, rate: 0.035 }, { max: 75000, rate: 0.05525 }, { max: 500000, rate: 0.0637 }, { max: 1000000, rate: 0.0897 }, { max: Infinity, rate: 0.1075 }], mfj: [{ max: 20000, rate: 0.014 }, { max: 50000, rate: 0.0175 }, { max: 70000, rate: 0.0245 }, { max: 80000, rate: 0.035 }, { max: 150000, rate: 0.05525 }, { max: 500000, rate: 0.0637 }, { max: 1000000, rate: 0.0897 }, { max: Infinity, rate: 0.1075 }] },
  NM: { single: [{ max: 5500, rate: 0.015 }, { max: 16500, rate: 0.032 }, { max: 33500, rate: 0.043 }, { max: 66500, rate: 0.047 }, { max: 210000, rate: 0.049 }, { max: Infinity, rate: 0.059 }], mfj: [{ max: 8000, rate: 0.015 }, { max: 25000, rate: 0.032 }, { max: 50000, rate: 0.043 }, { max: 100000, rate: 0.047 }, { max: 315000, rate: 0.049 }, { max: Infinity, rate: 0.059 }] },
  NV: 0,
  NY: { single: [{ max: 8500, rate: 0.04 }, { max: 11700, rate: 0.045 }, { max: 13900, rate: 0.0525 }, { max: 80650, rate: 0.055 }, { max: 215400, rate: 0.06 }, { max: 1077550, rate: 0.0685 }, { max: 5000000, rate: 0.0965 }, { max: 25000000, rate: 0.103 }, { max: Infinity, rate: 0.109 }], mfj: [{ max: 17150, rate: 0.04 }, { max: 23600, rate: 0.045 }, { max: 27900, rate: 0.0525 }, { max: 161550, rate: 0.055 }, { max: 323200, rate: 0.06 }, { max: 2155350, rate: 0.0685 }, { max: 5000000, rate: 0.0965 }, { max: 25000000, rate: 0.103 }, { max: Infinity, rate: 0.109 }] },
  OH: { single: [{ max: 100000, rate: 0.0275 }, { max: Infinity, rate: 0.035 }], mfj: [{ max: 100000, rate: 0.0275 }, { max: Infinity, rate: 0.035 }] },
  OK: { single: [{ max: 1000, rate: 0.0025 }, { max: 2500, rate: 0.0075 }, { max: 3750, rate: 0.0175 }, { max: 4900, rate: 0.0275 }, { max: 7200, rate: 0.0375 }, { max: Infinity, rate: 0.0475 }], mfj: [{ max: 2000, rate: 0.0025 }, { max: 5000, rate: 0.0075 }, { max: 7500, rate: 0.0175 }, { max: 9800, rate: 0.0275 }, { max: 14400, rate: 0.0375 }, { max: Infinity, rate: 0.0475 }] },
  OR: { single: [{ max: 4400, rate: 0.0475 }, { max: 11050, rate: 0.0675 }, { max: 125000, rate: 0.0875 }, { max: Infinity, rate: 0.099 }], mfj: [{ max: 8800, rate: 0.0475 }, { max: 22100, rate: 0.0675 }, { max: 250000, rate: 0.0875 }, { max: Infinity, rate: 0.099 }] },
  PA: 0.0307,
  RI: { single: [{ max: 79900, rate: 0.0375 }, { max: 181650, rate: 0.0475 }, { max: Infinity, rate: 0.0599 }], mfj: [{ max: 79900, rate: 0.0375 }, { max: 181650, rate: 0.0475 }, { max: Infinity, rate: 0.0599 }] },
  SC: { single: [{ max: 3560, rate: 0 }, { max: 17830, rate: 0.03 }, { max: Infinity, rate: 0.062 }], mfj: [{ max: 3560, rate: 0 }, { max: 17830, rate: 0.03 }, { max: Infinity, rate: 0.062 }] },
  SD: 0,
  TN: 0,
  TX: 0,
  UT: 0.0455,
  VA: { single: [{ max: 3000, rate: 0.02 }, { max: 5000, rate: 0.03 }, { max: 17000, rate: 0.05 }, { max: Infinity, rate: 0.0575 }], mfj: [{ max: 3000, rate: 0.02 }, { max: 5000, rate: 0.03 }, { max: 17000, rate: 0.05 }, { max: Infinity, rate: 0.0575 }] },
  VT: { single: [{ max: 47900, rate: 0.0335 }, { max: 116000, rate: 0.066 }, { max: 242000, rate: 0.076 }, { max: Infinity, rate: 0.0875 }], mfj: [{ max: 79950, rate: 0.0335 }, { max: 193300, rate: 0.066 }, { max: 294600, rate: 0.076 }, { max: Infinity, rate: 0.0875 }] },
  WA: 0,
  WI: { single: [{ max: 14680, rate: 0.035 }, { max: 29370, rate: 0.044 }, { max: 323290, rate: 0.053 }, { max: Infinity, rate: 0.0765 }], mfj: [{ max: 19580, rate: 0.035 }, { max: 39150, rate: 0.044 }, { max: 431060, rate: 0.053 }, { max: Infinity, rate: 0.0765 }] },
  WV: { single: [{ max: 10000, rate: 0.0222 }, { max: 25000, rate: 0.0296 }, { max: 40000, rate: 0.0333 }, { max: 60000, rate: 0.0444 }, { max: Infinity, rate: 0.0482 }], mfj: [{ max: 10000, rate: 0.0222 }, { max: 25000, rate: 0.0296 }, { max: 40000, rate: 0.0333 }, { max: 60000, rate: 0.0444 }, { max: Infinity, rate: 0.0482 }] },
  WY: 0,
}

// ── State Metadata (non-bracket) ──────────────────────────────────

const STATES = {
  AL: { name: 'Alabama', abbr: 'AL', allMuniExempt: false },
  AK: { name: 'Alaska', abbr: 'AK', allMuniExempt: false },
  AZ: { name: 'Arizona', abbr: 'AZ', allMuniExempt: false },
  AR: { name: 'Arkansas', abbr: 'AR', allMuniExempt: false },
  CA: { name: 'California', abbr: 'CA', allMuniExempt: false },
  CO: { name: 'Colorado', abbr: 'CO', allMuniExempt: false },
  CT: { name: 'Connecticut', abbr: 'CT', allMuniExempt: false },
  DE: { name: 'Delaware', abbr: 'DE', allMuniExempt: false },
  FL: { name: 'Florida', abbr: 'FL', allMuniExempt: false },
  GA: { name: 'Georgia', abbr: 'GA', allMuniExempt: false },
  HI: { name: 'Hawaii', abbr: 'HI', allMuniExempt: false },
  ID: { name: 'Idaho', abbr: 'ID', allMuniExempt: false },
  IL: { name: 'Illinois', abbr: 'IL', allMuniExempt: false },
  IN: { name: 'Indiana', abbr: 'IN', allMuniExempt: false },
  IA: { name: 'Iowa', abbr: 'IA', allMuniExempt: false },
  KS: { name: 'Kansas', abbr: 'KS', allMuniExempt: false },
  KY: { name: 'Kentucky', abbr: 'KY', allMuniExempt: false },
  LA: { name: 'Louisiana', abbr: 'LA', allMuniExempt: false },
  ME: { name: 'Maine', abbr: 'ME', allMuniExempt: false },
  MD: { name: 'Maryland', abbr: 'MD', allMuniExempt: false },
  MA: { name: 'Massachusetts', abbr: 'MA', allMuniExempt: false },
  MI: { name: 'Michigan', abbr: 'MI', allMuniExempt: false },
  MN: { name: 'Minnesota', abbr: 'MN', allMuniExempt: false },
  MS: { name: 'Mississippi', abbr: 'MS', allMuniExempt: false },
  MO: { name: 'Missouri', abbr: 'MO', allMuniExempt: false },
  MT: { name: 'Montana', abbr: 'MT', allMuniExempt: false },
  NE: { name: 'Nebraska', abbr: 'NE', allMuniExempt: false },
  NV: { name: 'Nevada', abbr: 'NV', allMuniExempt: false },
  NH: { name: 'New Hampshire', abbr: 'NH', allMuniExempt: false },
  NJ: { name: 'New Jersey', abbr: 'NJ', allMuniExempt: false },
  NM: { name: 'New Mexico', abbr: 'NM', allMuniExempt: false },
  NY: { name: 'New York', abbr: 'NY', allMuniExempt: false },
  NC: { name: 'North Carolina', abbr: 'NC', allMuniExempt: false },
  ND: { name: 'North Dakota', abbr: 'ND', allMuniExempt: false },
  OH: { name: 'Ohio', abbr: 'OH', allMuniExempt: false },
  OK: { name: 'Oklahoma', abbr: 'OK', allMuniExempt: false },
  OR: { name: 'Oregon', abbr: 'OR', allMuniExempt: false },
  PA: { name: 'Pennsylvania', abbr: 'PA', allMuniExempt: true },
  RI: { name: 'Rhode Island', abbr: 'RI', allMuniExempt: false },
  SC: { name: 'South Carolina', abbr: 'SC', allMuniExempt: false },
  SD: { name: 'South Dakota', abbr: 'SD', allMuniExempt: false },
  TN: { name: 'Tennessee', abbr: 'TN', allMuniExempt: false },
  TX: { name: 'Texas', abbr: 'TX', allMuniExempt: false },
  UT: { name: 'Utah', abbr: 'UT', allMuniExempt: false },
  VT: { name: 'Vermont', abbr: 'VT', allMuniExempt: false },
  VA: { name: 'Virginia', abbr: 'VA', allMuniExempt: false },
  WA: { name: 'Washington', abbr: 'WA', allMuniExempt: false },
  WV: { name: 'West Virginia', abbr: 'WV', allMuniExempt: false },
  WI: { name: 'Wisconsin', abbr: 'WI', allMuniExempt: false },
  WY: { name: 'Wyoming', abbr: 'WY', allMuniExempt: false },
}
const STATE_EDITOR_CODES = Object.keys(STATES)

const TAX_TYPES = [
  { code: 'TAXABLE',    label: 'Fully Taxable' },
  { code: 'TREASURY',   label: 'Treasury (State Exempt)' },
  { code: 'MUNI_NAT',   label: 'Fed Exempt (Muni)' },
  { code: 'MUNI_STATE', label: 'Fed+State Exempt' },
  { code: 'ROC',        label: 'Return of Capital' },
  { code: 'LTCG',       label: 'Qualified / LTCG' },
]

const ALLOC_COLORS = [
  '#7ecfff', '#4dff91', '#f9a825', '#b388ff', '#ff6b6b',
  '#64ffda', '#ff8a65', '#e040fb', '#69f0ae', '#ffd54f',
  '#4fc3f7', '#81c784', '#ffab91', '#ce93d8', '#80deea',
]

// ── Built-in Fund Database (~50 common income funds) ──────────────

const FUND_DB = {
  PDI:  { name: 'PIMCO Dynamic Income Fund', yield: 13.5, taxType: 'TAXABLE' },
  PDO:  { name: 'PIMCO Dynamic Income Opp.', yield: 12.8, taxType: 'TAXABLE' },
  PTY:  { name: 'PIMCO Corporate & Income Opp.', yield: 9.8, taxType: 'TAXABLE' },
  GOF:  { name: 'Guggenheim Strategic Opp.', yield: 14.2, taxType: 'TAXABLE' },
  NAD:  { name: 'Nuveen Quality Muni Income', yield: 5.2, taxType: 'MUNI_NAT' },
  NEA:  { name: 'Nuveen AMT-Free Quality Muni', yield: 5.8, taxType: 'MUNI_NAT' },
  NKX:  { name: 'Nuveen CA Quality Muni Inc', yield: 5.5, taxType: 'MUNI_STATE', muniState: 'CA' },
  VCV:  { name: 'Invesco CA Value Muni Income', yield: 4.5, taxType: 'MUNI_STATE', muniState: 'CA' },
  MUB:  { name: 'iShares National Muni Bond', yield: 3.3, taxType: 'MUNI_NAT' },
  VTEB: { name: 'Vanguard Tax-Exempt Bond', yield: 3.2, taxType: 'MUNI_NAT' },
  HYD:  { name: 'VanEck High Yield Muni', yield: 5.1, taxType: 'MUNI_NAT' },
  CMF:  { name: 'iShares California Muni Bond', yield: 2.8, taxType: 'MUNI_STATE', muniState: 'CA' },
  ARCC: { name: 'Ares Capital Corp', yield: 9.2, taxType: 'TAXABLE' },
  MAIN: { name: 'Main Street Capital', yield: 6.8, taxType: 'TAXABLE' },
  OBDC: { name: 'Blue Owl Capital Corp', yield: 10.5, taxType: 'TAXABLE' },
  HTGC: { name: 'Hercules Capital', yield: 10.2, taxType: 'TAXABLE' },
  GBDC: { name: 'Golub Capital BDC', yield: 10.8, taxType: 'TAXABLE' },
  TRIN: { name: 'Trinity Capital', yield: 14.5, taxType: 'TAXABLE' },
  JEPI: { name: 'JPMorgan Equity Premium Income', yield: 7.5, taxType: 'TAXABLE' },
  JEPQ: { name: 'JPMorgan Nasdaq Equity Premium', yield: 9.8, taxType: 'TAXABLE' },
  XYLD: { name: 'Global X S&P 500 Covered Call', yield: 10.2, taxType: 'TAXABLE' },
  QYLD: { name: 'Global X Nasdaq 100 Covered Call', yield: 11.5, taxType: 'TAXABLE' },
  RYLD: { name: 'Global X Russell 2000 Covered Call', yield: 11.8, taxType: 'TAXABLE' },
  SPYI: { name: 'NEOS S&P 500 High Income', yield: 11.5, taxType: 'TAXABLE' },
  QQQI: { name: 'NEOS Nasdaq 100 High Income', yield: 13.0, taxType: 'TAXABLE' },
  SVOL: { name: 'Simplify Volatility Premium', yield: 15.0, taxType: 'TAXABLE' },
  TSLY: { name: 'YieldMax TSLA Option Income', yield: 55.0, taxType: 'ROC' },
  NVDY: { name: 'YieldMax NVDA Option Income', yield: 45.0, taxType: 'ROC' },
  YMAX: { name: 'YieldMax Universe Fund of Option', yield: 28.0, taxType: 'ROC' },
  YMAG: { name: 'YieldMax Magnificent 7', yield: 25.0, taxType: 'ROC' },
  BLOX: { name: 'YieldMax Innovation Option', yield: 30.0, taxType: 'ROC' },
  CHPY: { name: 'YieldMax Semiconductor Portfolio Option Income ETF', yield: 45.62, taxType: 'ROC' },
  // YieldMax — single-stock option income
  MSFO: { name: 'YieldMax MSFT Option Income', yield: 28.0, taxType: 'ROC' },
  AMZY: { name: 'YieldMax AMZN Option Income', yield: 26.0, taxType: 'ROC' },
  GOOGY:{ name: 'YieldMax GOOGL Option Income', yield: 22.0, taxType: 'ROC' },
  APLY: { name: 'YieldMax AAPL Option Income', yield: 22.0, taxType: 'ROC' },
  FBY:  { name: 'YieldMax META Option Income', yield: 24.0, taxType: 'ROC' },
  CONY: { name: 'YieldMax COIN Option Income', yield: 65.0, taxType: 'ROC' },
  AMDY: { name: 'YieldMax AMD Option Income', yield: 38.0, taxType: 'ROC' },
  MRNY: { name: 'YieldMax MRNA Option Income', yield: 42.0, taxType: 'ROC' },
  NFLY: { name: 'YieldMax NFLX Option Income', yield: 24.0, taxType: 'ROC' },
  XOMO: { name: 'YieldMax XOM Option Income', yield: 12.0, taxType: 'ROC' },
  DISO: { name: 'YieldMax DIS Option Income', yield: 20.0, taxType: 'ROC' },
  OARK: { name: 'YieldMax ARKK Option Income', yield: 38.0, taxType: 'ROC' },
  JPMO: { name: 'YieldMax JPM Option Income', yield: 18.0, taxType: 'ROC' },
  PLTY: { name: 'YieldMax PLTR Option Income', yield: 80.0, taxType: 'ROC' },
  SNOY: { name: 'YieldMax SNAP Option Income', yield: 50.0, taxType: 'ROC' },
  PYPY: { name: 'YieldMax PYPL Option Income', yield: 26.0, taxType: 'ROC' },
  SQY:  { name: 'YieldMax SQ Option Income', yield: 35.0, taxType: 'ROC' },
  YBIT: { name: 'YieldMax Bitcoin Option Income', yield: 55.0, taxType: 'ROC' },
  SMCY: { name: 'YieldMax SMCI Option Income', yield: 45.0, taxType: 'ROC' },
  BABO: { name: 'YieldMax BABA Option Income', yield: 30.0, taxType: 'ROC' },
  AIXY: { name: 'YieldMax AI Option Income', yield: 22.0, taxType: 'ROC' },
  ULTY: { name: 'YieldMax Ultra Option Income', yield: 90.0, taxType: 'ROC' },
  // TappAlpha — covered-call innovation ETFs
  TDAQ: { name: 'TappAlpha Innovation 100 ETF', yield: 2.5, taxType: 'TAXABLE' },
  TSPY: { name: 'TappAlpha SPY Power Premium ETF', yield: 3.0, taxType: 'TAXABLE' },
  // Global X — covered-call & income (additions to XYLD/QYLD/RYLD)
  QYLG: { name: 'Global X Nasdaq 100 Covered Call & Growth', yield: 7.0, taxType: 'TAXABLE' },
  XYLG: { name: 'Global X S&P 500 Covered Call & Growth', yield: 6.0, taxType: 'TAXABLE' },
  DIV:  { name: 'Global X SuperDividend U.S. ETF', yield: 7.5, taxType: 'TAXABLE' },
  SDIV: { name: 'Global X SuperDividend ETF', yield: 11.0, taxType: 'TAXABLE' },
  ALTY: { name: 'Global X Alternative Income ETF', yield: 8.5, taxType: 'TAXABLE' },
  PFFD: { name: 'Global X U.S. Preferred ETF', yield: 6.5, taxType: 'TAXABLE' },
  MLPX: { name: 'Global X MLP & Energy Infrastructure ETF', yield: 5.8, taxType: 'TAXABLE' },
  MLPA: { name: 'Global X MLP ETF', yield: 8.0, taxType: 'ROC' },
  EFAS: { name: 'Global X MSCI SuperDividend EAFE ETF', yield: 7.0, taxType: 'TAXABLE' },
  SDEM: { name: 'Global X MSCI SuperDividend EM ETF', yield: 7.5, taxType: 'TAXABLE' },
  HYKE: { name: 'Global X High Yield Bond & Option Strategy', yield: 8.0, taxType: 'TAXABLE' },
  LQDW: { name: 'Global X IG Bond & Option Strategy ETF', yield: 5.5, taxType: 'TAXABLE' },
  // REX Shares — equity premium income
  FEPI: { name: 'REX FANG & Innovation Equity Premium Income', yield: 27.0, taxType: 'TAXABLE' },
  AIPI: { name: 'REX AI Equity Premium Income ETF', yield: 30.0, taxType: 'TAXABLE' },
  CEPI: { name: 'REX Clean Energy Equity Premium Income', yield: 22.0, taxType: 'TAXABLE' },
  // Amplify — income ETFs
  DIVO: { name: 'Amplify CWP Enhanced Dividend Income', yield: 4.5, taxType: 'TAXABLE' },
  QDVO: { name: 'Amplify Equity Power Buffer ETF', yield: 10.0, taxType: 'TAXABLE' },
  YYY:  { name: 'Amplify High Income ETF', yield: 11.0, taxType: 'TAXABLE' },
  BLOK: { name: 'Amplify Transformational Data Sharing', yield: 3.0, taxType: 'LTCG' },
  // Kurv — single-stock yield premium ETFs
  KSPY: { name: 'Kurv S&P 500 Yield Premium Strategy', yield: 14.0, taxType: 'TAXABLE' },
  KQQQ: { name: 'Kurv Nasdaq-100 Yield Premium Strategy', yield: 16.0, taxType: 'TAXABLE' },
  KNVD: { name: 'Kurv NVIDIA Yield Premium Strategy', yield: 22.0, taxType: 'TAXABLE' },
  KTSL: { name: 'Kurv Tesla Yield Premium Strategy', yield: 28.0, taxType: 'TAXABLE' },
  KAPL: { name: 'Kurv Apple Yield Premium Strategy', yield: 16.0, taxType: 'TAXABLE' },
  KMET: { name: 'Kurv Meta Yield Premium Strategy', yield: 18.0, taxType: 'TAXABLE' },
  KAMZ: { name: 'Kurv Amazon Yield Premium Strategy', yield: 18.0, taxType: 'TAXABLE' },
  // SABA Capital — closed-end fund ETF
  CEFS: { name: 'Saba Closed-End Funds ETF', yield: 13.0, taxType: 'TAXABLE' },
  JAAA: { name: 'Janus AAA CLO ETF', yield: 6.2, taxType: 'TAXABLE' },
  JBBB: { name: 'Janus B-BB CLO ETF', yield: 7.5, taxType: 'TAXABLE' },
  CLOA: { name: 'PanAgora Defined Risk CLO', yield: 6.8, taxType: 'TAXABLE' },
  SGOV: { name: 'iShares 0-3 Month Treasury Bond', yield: 5.2, taxType: 'TREASURY' },
  BIL:  { name: 'SPDR Bloomberg 1-3 Month T-Bill', yield: 5.1, taxType: 'TREASURY' },
  TLT:  { name: 'iShares 20+ Year Treasury Bond', yield: 4.4, taxType: 'TREASURY' },
  IEF:  { name: 'iShares 7-10 Year Treasury Bond', yield: 4.1, taxType: 'TREASURY' },
  USFR: { name: 'WisdomTree Floating Rate Treasury', yield: 5.3, taxType: 'TREASURY' },
  SHV:  { name: 'iShares Short Treasury Bond', yield: 5.0, taxType: 'TREASURY' },
  VGIT: { name: 'Vanguard Intermediate-Term Treasury', yield: 3.8, taxType: 'TREASURY' },
  VGLT: { name: 'Vanguard Long-Term Treasury', yield: 4.3, taxType: 'TREASURY' },
  O:    { name: 'Realty Income Corp', yield: 5.8, taxType: 'TAXABLE' },
  STAG: { name: 'STAG Industrial', yield: 4.0, taxType: 'TAXABLE' },
  AGNC: { name: 'AGNC Investment Corp', yield: 15.5, taxType: 'TAXABLE' },
  NLY:  { name: 'Annaly Capital Mgmt', yield: 13.2, taxType: 'TAXABLE' },
  RITM: { name: 'Rithm Capital Corp', yield: 9.5, taxType: 'TAXABLE' },
  SPY:  { name: 'SPDR S&P 500 ETF', yield: 1.3, taxType: 'LTCG' },
  VOO:  { name: 'Vanguard S&P 500 ETF', yield: 1.3, taxType: 'LTCG' },
  QQQ:  { name: 'Invesco QQQ Trust', yield: 0.6, taxType: 'LTCG' },
  VTI:  { name: 'Vanguard Total Stock Market', yield: 1.3, taxType: 'LTCG' },
  SCHD: { name: 'Schwab U.S. Dividend Equity', yield: 3.5, taxType: 'LTCG' },
  GLD:  { name: 'SPDR Gold Shares', yield: 0, taxType: 'LTCG' },
  IBIT: { name: 'iShares Bitcoin Trust', yield: 0, taxType: 'LTCG' },
}

// ── localStorage Persistence ──────────────────────────────────────

const STORAGE_KEY = 'blendedYield_brackets'

const copyBrackets = arr => arr.map(b => ({ ...b }))
const copyTaxData = value => typeof value === 'number'
  ? value
  : { single: copyBrackets(value.single), mfj: copyBrackets(value.mfj) }

function defaultBracketData() {
  const stateDefaults = Object.fromEntries(
    STATE_EDITOR_CODES.map(code => [code, copyTaxData(DEFAULT_STATE_TAX[code])])
  )
  return {
    fed:  { single: copyBrackets(DEFAULT_FED_BRACKETS.single), mfj: copyBrackets(DEFAULT_FED_BRACKETS.mfj) },
    ltcg: { single: copyBrackets(DEFAULT_FED_LTCG.single), mfj: copyBrackets(DEFAULT_FED_LTCG.mfj) },
    ...stateDefaults,
  }
}

function loadSavedBrackets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const fix = arr => arr.map((b, i, a) => ({ ...b, max: (i === a.length - 1 || b.max === null) ? Infinity : b.max }))
    const fixSet = (saved, fallback) => {
      if (!saved) return fallback
      return { single: fix(saved.single || fallback.single), mfj: fix(saved.mfj || fallback.mfj) }
    }
    const defaults = defaultBracketData()
    const saved = STATE_EDITOR_CODES.reduce((acc, code) => {
      acc[code] = typeof defaults[code] === 'number'
        ? (data[code] ?? defaults[code])
        : fixSet(data[code], defaults[code])
      return acc
    }, {
      fed:  fixSet(data.fed, defaults.fed),
      ltcg: fixSet(data.ltcg, defaults.ltcg),
    })
    return { ...defaults, ...saved }
  } catch { return null }
}

function saveBracketsToStorage(data) {
  const ser = arr => arr.map(b => ({ ...b, max: b.max === Infinity ? null : b.max }))
  const serSet = s => ({ single: ser(s.single), mfj: ser(s.mfj) })
  const payload = STATE_EDITOR_CODES.reduce((acc, code) => {
    acc[code] = typeof data[code] === 'number' ? data[code] : serSet(data[code])
    return acc
  }, {
    fed: serSet(data.fed),
    ltcg: serSet(data.ltcg),
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

// ── Tax Computation ───────────────────────────────────────────────

function marginalRate(income, brackets) {
  for (const b of brackets) {
    if (income <= b.max) return b.rate
  }
  return brackets[brackets.length - 1].rate
}

function computeFundTax(yieldPct, taxType, fedRate, ltcgRate, stateRate, allMuniExempt) {
  const fullRate = fedRate + stateRate
  let applicableRate
  switch (taxType) {
    case 'TAXABLE':    applicableRate = fullRate; break
    case 'TREASURY':   applicableRate = fedRate; break
    case 'MUNI_NAT':   applicableRate = allMuniExempt ? 0 : stateRate; break
    case 'MUNI_STATE': applicableRate = 0; break
    case 'ROC':
    case 'LTCG':       applicableRate = ltcgRate + stateRate; break
    default:           applicableRate = fullRate
  }
  const aty = yieldPct * (1 - applicableRate)
  const tey = fullRate < 1 ? aty / (1 - fullRate) : aty
  return { aty, tey, applicableRate }
}

// ── Formatting ────────────────────────────────────────────────────

const fmtMoney = v => formatMoneyWhole(v)
const fmtMoney2 = v => formatMoney(v)
const fmtPct = (v, d = 2) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d) + '%'
const fmtShares = v => (v == null || isNaN(v) || v === 0) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtRate = v => fmtPct(v * 100, 1)
const fmtThreshold = v => formatMoneyWhole(v)

function shortTaxLabel(code, abbr) {
  switch (code) {
    case 'TAXABLE':    return 'Taxable'
    case 'TREASURY':   return 'Treasury'
    case 'MUNI_NAT':   return 'Muni (Natl)'
    case 'MUNI_STATE': return `Muni (${abbr})`
    case 'ROC':        return 'ROC'
    case 'LTCG':       return 'Qual/LTCG'
    default:           return code
  }
}

function inferLookupTaxType(ticker, name) {
  const text = `${ticker || ''} ${name || ''}`.toUpperCase()
  if (text.includes('YIELDMAX')) return 'ROC'
  if (text.includes('TREASURY') || text.includes('T-BILL') || text.includes('T BILL')) return 'TREASURY'
  if (text.includes('MUNI') || text.includes('MUNICIPAL') || text.includes('TAX-EXEMPT')) return 'MUNI_NAT'
  return 'TAXABLE'
}

// Resolve a ticker's name, distribution yield, and tax classification via the
// live lookup endpoint, falling back to the built-in fund database.
async function resolveFundData(sym, stateCode) {
  const db = FUND_DB[sym]
  let taxType = 'TAXABLE', name = '', yieldPct = 0, price = 0
  try {
    const r = await fetch(`${API_BASE}/api/dividend-calc/lookup/${encodeURIComponent(sym)}`)
    const d = await r.json()
    if (!r.ok || d.error) throw new Error(d.error || 'Lookup failed')
    name = d.name || db?.name || ''
    yieldPct = Number(d.yield_pct || 0) || db?.yield || 0
    price = Number(d.price || 0) || 0
    taxType = db?.taxType || inferLookupTaxType(d.ticker || sym, name)
  } catch {
    if (db) {
      name = db.name
      yieldPct = db.yield
      taxType = db.taxType
    }
  }
  taxType = (taxType === 'MUNI_STATE' && db?.muniState && db.muniState !== stateCode)
    ? 'MUNI_NAT' : taxType
  return { name, yieldPct, taxType, price }
}

// ── Bracket Table Editor ──────────────────────────────────────────

function BracketTable({ brackets, onChange }) {
  const update = (idx, field, value) => {
    onChange(brackets.map((b, i) => i === idx ? { ...b, [field]: value } : b))
  }
  const addRow = () => {
    const prev = brackets.length >= 2 ? brackets[brackets.length - 2] : null
    const last = brackets[brackets.length - 1]
    const newMax = (prev?.max || 0) + 50000
    onChange([...brackets.slice(0, -1), { max: newMax, rate: last.rate }, last])
  }
  const removeRow = (idx) => {
    if (brackets.length <= 1 || idx === brackets.length - 1) return
    onChange(brackets.filter((_, i) => i !== idx))
  }

  return (
    <div className="by-bracket-wrap">
      <table className="by-bracket-table">
        <thead>
          <tr><th>Income Up To</th><th>Rate %</th><th></th></tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => {
            const isLast = i === brackets.length - 1
            return (
              <tr key={i}>
                <td>
                  {isLast
                    ? <span className="by-muted">No limit</span>
                    : <input type="number" className="by-bracket-input"
                        value={b.max} onChange={e => update(i, 'max', Number(e.target.value) || 0)} step={100} />
                  }
                </td>
                <td>
                  <input type="number" className="by-bracket-input by-bracket-rate"
                    value={Number((b.rate * 100).toFixed(2))}
                    onChange={e => update(i, 'rate', (Number(e.target.value) || 0) / 100)} step={0.1} />
                </td>
                <td>
                  {!isLast && brackets.length > 1 && (
                    <button className="by-bracket-remove" onClick={() => removeRow(i)} title="Remove bracket">x</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button className="by-bracket-add" onClick={addRow}>+ Add Bracket</button>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────

let nextFundId = 1

export default function BlendedYield() {
  const pf = useProfileFetch()
  const [stateCode, setStateCode] = useState('CA')
  const [filing, setFiling] = useState('mfj')
  const [income, setIncome] = useState(150000)
  const [totalInvestment, setTotalInvestment] = useState(100000)
  const [funds, setFunds] = useState([])
  const [tickerInput, setTickerInput] = useState('')
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false)
  const [portfolioHoldings, setPortfolioHoldings] = useState([])
  const [portfolioSearch, setPortfolioSearch] = useState('')
  const [portfolioSelected, setPortfolioSelected] = useState(() => new Set())

  // Bracket data (loaded from localStorage or defaults)
  const [bracketData, setBracketData] = useState(() => loadSavedBrackets() || defaultBracketData())
  const [showEditor, setShowEditor] = useState(false)
  const [editorFiling, setEditorFiling] = useState('mfj')
  const [bracketsDirty, setBracketsDirty] = useState(false)
  const [hasSavedBrackets, setHasSavedBrackets] = useState(() => localStorage.getItem(STORAGE_KEY) !== null)

  const state = STATES[stateCode]

  // Computed tax rates using editable bracket data
  const fedRate = useMemo(() => marginalRate(income, bracketData.fed[filing]), [income, filing, bracketData])
  const ltcgRate = useMemo(() => marginalRate(income, bracketData.ltcg[filing]), [income, filing, bracketData])
  const stateRate = useMemo(() => {
    const data = bracketData[stateCode]
    return typeof data === 'number' ? data : marginalRate(income, data[filing])
  }, [stateCode, filing, income, bracketData])
  const combinedRate = fedRate + stateRate

  // Bracket update helpers
  const updateFedBrackets = useCallback((f, brackets) => {
    setBracketData(prev => ({ ...prev, fed: { ...prev.fed, [f]: brackets } }))
    setBracketsDirty(true)
  }, [])
  const updateLtcgBrackets = useCallback((f, brackets) => {
    setBracketData(prev => ({ ...prev, ltcg: { ...prev.ltcg, [f]: brackets } }))
    setBracketsDirty(true)
  }, [])
  const updateStateBrackets = useCallback((st, f, brackets) => {
    setBracketData(prev => ({ ...prev, [st]: { ...prev[st], [f]: brackets } }))
    setBracketsDirty(true)
  }, [])
  const updateFlatRate = useCallback((st, rate) => {
    setBracketData(prev => ({ ...prev, [st]: rate }))
    setBracketsDirty(true)
  }, [])

  const handleSaveBrackets = useCallback(() => {
    saveBracketsToStorage(bracketData)
    setBracketsDirty(false)
    setHasSavedBrackets(true)
  }, [bracketData])

  const handleRestoreDefaults = useCallback(() => {
    const defaults = defaultBracketData()
    setBracketData(defaults)
    localStorage.removeItem(STORAGE_KEY)
    setBracketsDirty(false)
    setHasSavedBrackets(false)
  }, [])

  const changeState = useCallback((newCode) => {
    setStateCode(newCode)
    setFunds(prev => prev.map(f => {
      const db = FUND_DB[f.ticker]
      if (!db || !db.muniState) return f
      return { ...f, taxType: db.muniState === newCode ? 'MUNI_STATE' : 'MUNI_NAT' }
    }))
  }, [])

  const addFund = useCallback(async (ticker) => {
    const sym = (ticker || '').trim().toUpperCase()
    if (!sym) return
    if (funds.some(f => f.ticker === sym)) return
    const { name, yieldPct, taxType, price } = await resolveFundData(sym, stateCode)
    setFunds(prev => [...prev, {
      id: nextFundId++, ticker: sym, name, yieldPct, taxType, price,
      allocPct: 0, allocDollar: 0,
      color: ALLOC_COLORS[prev.length % ALLOC_COLORS.length],
    }])
  }, [funds, stateCode])

  const loadPortfolioHoldings = useCallback(async () => {
    setShowPortfolioPicker(true)
    setLoadingPortfolio(true)
    try {
      const res = await pf('/api/portfolio-tester/holdings')
      const data = await res.json()
      const rows = (data.holdings || []).filter(h => (h.current_value || 0) > 0)
      if (!rows.length) {
        setPortfolioHoldings([])
        setPortfolioSelected(new Set())
        window.alert('No current holdings found for the selected portfolio.')
        setLoadingPortfolio(false)
        return
      }
      const normalized = rows.map(h => ({
        ...h,
        ticker: (h.ticker || '').toUpperCase(),
        current_value: Number(h.current_value || 0),
      })).filter(h => h.ticker)
      setPortfolioHoldings(normalized)
      setPortfolioSelected(new Set(normalized.map(h => h.ticker)))
      setShowPortfolioPicker(true)
    } catch (e) {
      console.error(e)
      window.alert('Failed to load current portfolio.')
    }
    setLoadingPortfolio(false)
  }, [pf])

  const togglePortfolioPicker = useCallback(() => {
    if (showPortfolioPicker) {
      setShowPortfolioPicker(false)
      return
    }
    loadPortfolioHoldings()
  }, [loadPortfolioHoldings, showPortfolioPicker])

  const visiblePortfolioHoldings = useMemo(() => {
    const q = portfolioSearch.trim().toUpperCase()
    if (!q) return portfolioHoldings
    return portfolioHoldings.filter(h => {
      const categories = (h.categories || []).join(' ')
      const dbName = FUND_DB[h.ticker]?.name || ''
      return `${h.ticker} ${dbName} ${categories}`.toUpperCase().includes(q)
    })
  }, [portfolioHoldings, portfolioSearch])

  const portfolioSelectedCount = portfolioSelected.size

  const togglePortfolioTicker = useCallback((ticker) => {
    setPortfolioSelected(prev => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }, [])

  const selectAllPortfolioTickers = useCallback(() => {
    setPortfolioSelected(new Set(portfolioHoldings.map(h => h.ticker)))
  }, [portfolioHoldings])

  const deselectAllPortfolioTickers = useCallback(() => {
    setPortfolioSelected(new Set())
  }, [])

  const addSelectedPortfolioTickers = useCallback(async () => {
    const existing = new Set(funds.map(f => f.ticker))
    const selectedRows = portfolioHoldings.filter(h => portfolioSelected.has(h.ticker) && !existing.has(h.ticker))
    if (!selectedRows.length) {
      window.alert(portfolioSelected.size ? 'The selected portfolio tickers are already in the calculator.' : 'Select at least one portfolio ticker to add.')
      return
    }

    setLoadingPortfolio(true)
    try {
      const resolved = await Promise.all(
        selectedRows.map(h => resolveFundData(h.ticker, stateCode))
      )
      const existingRows = funds.map(f => ({ ...f, allocDollar: Math.round(Number(f.allocDollar) || 0) }))
      const addedRows = selectedRows.map((h, i) => {
        const dollars = Math.round(h.current_value || 0)
        return {
          id: nextFundId++,
          ticker: h.ticker,
          name: resolved[i].name,
          yieldPct: resolved[i].yieldPct,
          taxType: resolved[i].taxType,
          price: resolved[i].price,
          allocDollar: dollars,
          allocPct: 0,
          color: ALLOC_COLORS[(existingRows.length + i) % ALLOC_COLORS.length],
        }
      })
      const combined = [...existingRows, ...addedRows]
      const total = combined.reduce((s, f) => s + (Number(f.allocDollar) || 0), 0)
      setTotalInvestment(Math.round(total))
      setFunds(combined.map((f, i) => ({
        ...f,
        allocPct: total > 0 ? Number(((Number(f.allocDollar) || 0) / total * 100).toFixed(2)) : f.allocPct,
        color: f.color || ALLOC_COLORS[i % ALLOC_COLORS.length],
      })))
      setShowPortfolioPicker(false)
    } catch (e) {
      console.error(e)
      window.alert('Failed to add selected portfolio tickers.')
    }
    setLoadingPortfolio(false)
  }, [funds, portfolioHoldings, portfolioSelected, stateCode])

  const removeFund = useCallback((id) => {
    setFunds(prev => prev.filter(f => f.id !== id))
  }, [])

  const updateFund = useCallback((id, patch) => {
    setFunds(prev => prev.map(f => {
      if (f.id !== id) return f
      const next = { ...f, ...patch }
      if ('allocPct' in patch && totalInvestment > 0)
        next.allocDollar = Math.round(totalInvestment * (Number(next.allocPct) || 0) / 100)
      else if ('allocDollar' in patch && totalInvestment > 0)
        next.allocPct = Number(((Number(next.allocDollar) || 0) / totalInvestment * 100).toFixed(2))
      return next
    }))
  }, [totalInvestment])

  const splitEqually = useCallback(() => {
    if (!funds.length) return
    const pct = Number((100 / funds.length).toFixed(2))
    setFunds(prev => prev.map(f => ({
      ...f, allocPct: pct, allocDollar: Math.round(totalInvestment * pct / 100),
    })))
  }, [funds.length, totalInvestment])

  const resetAll = useCallback(() => { setFunds([]); setTickerInput(''); setPortfolioSelected(new Set()) }, [])

  const updateTotalInvestment = useCallback((val) => {
    const v = Number(val) || 0
    setTotalInvestment(v)
    setFunds(prev => prev.map(f => ({
      ...f, allocDollar: Math.round(v * (Number(f.allocPct) || 0) / 100),
    })))
  }, [])

  const fundMetrics = useMemo(() => funds.map(f => {
    const m = computeFundTax(f.yieldPct, f.taxType, fedRate, ltcgRate, stateRate, state.allMuniExempt)
    const grossIncome = (f.allocDollar || 0) * (f.yieldPct || 0) / 100
    const netIncome = (f.allocDollar || 0) * (m.aty || 0) / 100
    const shares = f.price > 0 ? (f.allocDollar || 0) / f.price : 0
    return { ...f, ...m, grossIncome, netIncome, shares }
  }), [funds, fedRate, ltcgRate, stateRate, state.allMuniExempt])

  const portfolio = useMemo(() => {
    const totalAllocPct = fundMetrics.reduce((s, f) => s + (Number(f.allocPct) || 0), 0)
    const totalGrossIncome = fundMetrics.reduce((s, f) => s + f.grossIncome, 0)
    const totalNetIncome = fundMetrics.reduce((s, f) => s + f.netIncome, 0)
    const totalShares = fundMetrics.reduce((s, f) => s + (f.shares || 0), 0)
    let blendedTEY = 0, blendedATY = 0, blendedGross = 0
    if (totalAllocPct > 0) {
      blendedTEY = fundMetrics.reduce((s, f) => s + f.tey * (f.allocPct || 0), 0) / totalAllocPct
      blendedATY = fundMetrics.reduce((s, f) => s + f.aty * (f.allocPct || 0), 0) / totalAllocPct
      blendedGross = fundMetrics.reduce((s, f) => s + f.yieldPct * (f.allocPct || 0), 0) / totalAllocPct
    }
    return { totalAllocPct, totalGrossIncome, totalNetIncome, totalShares, blendedTEY, blendedATY, blendedGross }
  }, [fundMetrics])

  const handleAdd = async (e) => { e?.preventDefault(); const sym = tickerInput; setTickerInput(''); await addFund(sym) }
  const muniStateLabel = `Fed+State Exempt (${state.abbr} Muni)`
  return (
    <div className="page by-page">
      <h1>Blended Yield Calculator</h1>
      <p className="by-subtitle">
        Calculate the true after-tax blended yield of your portfolio using {state.name} + Federal progressive tax brackets.
      </p>

      {/* ── Tax Profile ── */}
      <div className="by-card">
        <h3>Tax Profile</h3>
        <div className="by-profile-grid">
          <div className="by-field">
            <label>State</label>
            <select className="by-input" value={stateCode} onChange={e => changeState(e.target.value)}>
              {Object.entries(STATES).map(([c, s]) => <option key={c} value={c}>{s.name}</option>)}
            </select>
          </div>
          <div className="by-field">
            <label>Filing Status</label>
            <select className="by-input" value={filing} onChange={e => setFiling(e.target.value)}>
              <option value="mfj">Married Filing Jointly</option>
              <option value="single">Single</option>
            </select>
          </div>
          <div className="by-field">
            <label>Taxable Income</label>
            <div className="by-input-wrap">
              <span className="by-prefix">$</span>
              <input type="number" className="by-input by-input-prefixed" value={income}
                onChange={e => setIncome(Number(e.target.value) || 0)} step={1000} />
            </div>
          </div>
          <div className="by-field">
            <label>Total Portfolio Investment</label>
            <div className="by-input-wrap">
              <span className="by-prefix">$</span>
              <input type="number" className="by-input by-input-prefixed" value={totalInvestment}
                onChange={e => updateTotalInvestment(e.target.value)} step={1000} />
            </div>
          </div>
        </div>
        <div className="by-chips">
          <span className="by-chip by-chip-fed">Federal {fmtRate(fedRate)}</span>
          <span className="by-chip by-chip-state">{state.abbr} {fmtRate(stateRate)}</span>
          <span className="by-chip by-chip-combined">Combined {fmtRate(combinedRate)}</span>
          <span className="by-chip by-chip-ltcg">LTCG {fmtRate(ltcgRate)}</span>
        </div>
        {state.allMuniExempt && (
          <div className="by-note">{state.name} exempts all municipal bond interest from state income tax.</div>
        )}
      </div>

      {/* ── Tax Bracket Editor ── */}
      <div className="by-card by-editor-card">
        <div className="by-editor-toggle" onClick={() => setShowEditor(!showEditor)}>
          <h3>
            Tax Bracket Settings
            {hasSavedBrackets && <span className="by-custom-badge">Custom</span>}
            {bracketsDirty && <span className="by-dirty-badge">Unsaved</span>}
          </h3>
          <span className="by-toggle-arrow">{showEditor ? '▴' : '▾'}</span>
        </div>
        {showEditor && (
          <div className="by-editor-body">
            <div className="by-editor-filing-row">
              <span className="by-muted">Editing brackets for:</span>
              <button className={`by-filing-btn${editorFiling === 'single' ? ' active' : ''}`}
                onClick={() => setEditorFiling('single')}>Single</button>
              <button className={`by-filing-btn${editorFiling === 'mfj' ? ' active' : ''}`}
                onClick={() => setEditorFiling('mfj')}>Married Filing Jointly</button>
            </div>

            <div className="by-editor-grid">
              <div className="by-bracket-section">
                <h4>Federal Income Tax</h4>
                <BracketTable
                  brackets={bracketData.fed[editorFiling]}
                  onChange={b => updateFedBrackets(editorFiling, b)} />
              </div>

              <div className="by-bracket-section">
                <h4>Federal LTCG</h4>
                <BracketTable
                  brackets={bracketData.ltcg[editorFiling]}
                  onChange={b => updateLtcgBrackets(editorFiling, b)} />
              </div>

              {STATE_EDITOR_CODES.map(code => {
                const stateData = bracketData[code]
                const stateMeta = STATES[code]
                if (typeof stateData === 'number') {
                  return (
                    <div className="by-bracket-section by-flat-section" key={code}>
                      <h4>{stateMeta.name}</h4>
                      <div className="by-flat-rate">
                        <label>Flat Rate</label>
                        <div className="by-input-wrap">
                          <input type="number" className="by-input by-input-suffixed" step={0.01}
                            value={Number((stateData * 100).toFixed(3))}
                            onChange={e => updateFlatRate(code, (Number(e.target.value) || 0) / 100)} />
                          <span className="by-suffix">%</span>
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="by-bracket-section" key={code}>
                    <h4>{stateMeta.name}</h4>
                    <BracketTable
                      brackets={stateData[editorFiling]}
                      onChange={b => updateStateBrackets(code, editorFiling, b)} />
                  </div>
                )
              })}
            </div>

            <div className="by-editor-actions">
              <button className="btn btn-primary" onClick={handleSaveBrackets}>
                Save Brackets
              </button>
              <button className="btn btn-secondary" onClick={handleRestoreDefaults}>
                Restore 2025 Defaults
              </button>
              {!bracketsDirty && hasSavedBrackets && (
                <span className="by-saved-note">Custom brackets saved and active</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Add Fund ── */}
      <form className="by-add-bar" onSubmit={handleAdd}>
        <input type="text" className="by-input by-ticker-input" value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          placeholder="Enter ticker (e.g. SGOV, JEPI, MUB)" />
        <button type="submit" className="btn btn-secondary">Add Fund</button>
        <button type="button" className="btn btn-primary" onClick={togglePortfolioPicker} disabled={loadingPortfolio}>
          {loadingPortfolio ? 'Loading...' : `From Portfolio ${showPortfolioPicker ? '^' : 'v'}`}
        </button>
        {funds.length > 1 && (
          <button type="button" className="btn btn-secondary" onClick={splitEqually}>Split Equally</button>
        )}
        {funds.length > 0 && (
          <button type="button" className="btn by-reset-btn" onClick={resetAll}>Reset All</button>
        )}
      </form>

      {/* ── Fund Cards ── */}
      {showPortfolioPicker && (
        <div className="by-portfolio-picker">
          <div className="by-portfolio-picker-head">
            <div className="by-muted">
              Portfolio holdings ({portfolioHoldings.length} total):
            </div>
            <div className="by-portfolio-picker-tools">
              <input
                type="text"
                className="by-input by-portfolio-search"
                value={portfolioSearch}
                onChange={e => setPortfolioSearch(e.target.value)}
                placeholder="Search ticker..."
              />
              <button type="button" className="btn btn-sm" onClick={selectAllPortfolioTickers} disabled={loadingPortfolio || portfolioHoldings.length === 0}>Select All</button>
              <button type="button" className="btn btn-sm" onClick={deselectAllPortfolioTickers} disabled={loadingPortfolio || portfolioSelectedCount === 0}>Deselect All</button>
            </div>
          </div>

          <div className="by-portfolio-table-wrap">
            <table className="by-portfolio-table">
              <thead>
                <tr>
                  <th className="by-portfolio-check-col" aria-label="Selected"></th>
                  <th>Ticker</th>
                  <th>Description</th>
                  <th>Current Value</th>
                </tr>
              </thead>
              <tbody>
                {loadingPortfolio && !visiblePortfolioHoldings.length && (
                  <tr>
                    <td colSpan={4} className="by-portfolio-empty">Loading portfolio holdings...</td>
                  </tr>
                )}
                {!loadingPortfolio && visiblePortfolioHoldings.map(h => {
                  const description = FUND_DB[h.ticker]?.name || (h.categories || []).join(', ') || 'Current portfolio holding'
                  return (
                    <tr key={h.ticker} onClick={() => togglePortfolioTicker(h.ticker)}>
                      <td className="by-portfolio-check-col">
                        <input
                          type="checkbox"
                          checked={portfolioSelected.has(h.ticker)}
                          onChange={() => togglePortfolioTicker(h.ticker)}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td><strong>{h.ticker}</strong></td>
                      <td className="by-portfolio-description">{description}</td>
                      <td>{fmtMoney(h.current_value)}</td>
                    </tr>
                  )
                })}
                {!loadingPortfolio && !visiblePortfolioHoldings.length && (
                  <tr>
                    <td colSpan={4} className="by-portfolio-empty">No holdings match that search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="by-portfolio-picker-foot">
            <span className="by-muted">{portfolioSelectedCount} selected</span>
            <div className="by-portfolio-picker-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowPortfolioPicker(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={addSelectedPortfolioTickers}
                disabled={loadingPortfolio || portfolioSelectedCount === 0}>
                Add Tickers
              </button>
            </div>
          </div>
        </div>
      )}

      {fundMetrics.map(f => (
        <div className="by-fund-card" key={f.id} style={{ borderLeftColor: f.color }}>
          <div className="by-fund-head">
            <div>
              <strong style={{ color: f.color }}>{f.ticker}</strong>
              {f.name
                ? <span className="by-muted"> — {f.name}</span>
                : <span className="by-muted"> (manual entry)</span>}
            </div>
            <button className="btn btn-sm" onClick={() => removeFund(f.id)}>Remove</button>
          </div>
          <div className="by-fund-grid">
            {!FUND_DB[f.ticker] && (
              <div className="by-field by-field-wide">
                <label>Fund Name</label>
                <input type="text" className="by-input" value={f.name}
                  onChange={e => updateFund(f.id, { name: e.target.value })} placeholder="Enter fund name" />
              </div>
            )}
            <div className="by-field">
              <label>Distribution Yield</label>
              <div className="by-input-wrap">
                <input type="number" className="by-input by-input-suffixed" value={f.yieldPct}
                  onChange={e => updateFund(f.id, { yieldPct: Number(e.target.value) || 0 })} step={0.1} />
                <span className="by-suffix">%</span>
              </div>
            </div>
            <div className="by-field">
              <label>Tax Classification</label>
              <select className="by-input" value={f.taxType}
                onChange={e => updateFund(f.id, { taxType: e.target.value })}>
                {TAX_TYPES.map(t => (
                  <option key={t.code} value={t.code}>
                    {t.code === 'MUNI_STATE' ? muniStateLabel : t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="by-field">
              <label>Allocation %</label>
              <div className="by-input-wrap">
                <input type="number" className="by-input by-input-suffixed" value={f.allocPct}
                  onChange={e => updateFund(f.id, { allocPct: Number(e.target.value) || 0 })}
                  min={0} max={100} step={0.5} />
                <span className="by-suffix">%</span>
              </div>
            </div>
            <div className="by-field">
              <label>Allocation $</label>
              <div className="by-input-wrap">
                <span className="by-prefix">$</span>
                <input type="number" className="by-input by-input-prefixed" value={f.allocDollar}
                  onChange={e => updateFund(f.id, { allocDollar: Number(e.target.value) || 0 })} step={100} />
              </div>
            </div>
          </div>
          {f.yieldPct > 0 && (
            <div className="by-fund-results">
              <div className="by-fund-metric">
                <span className="by-metric-label">Annual Income</span>
                <span className="by-metric-value">{fmtMoney2(f.grossIncome)}</span>
              </div>
              <div className="by-fund-metric">
                <span className="by-metric-label">Monthly</span>
                <span className="by-metric-value">{fmtMoney2(f.grossIncome / 12)}</span>
              </div>
              <div className="by-fund-metric">
                <span className="by-metric-label">After-Tax Yield</span>
                <span className="by-metric-value">{fmtPct(f.aty)}</span>
              </div>
              <div className="by-fund-metric by-metric-active">
                <span className="by-metric-label">Tax-Equiv Yield</span>
                <span className="by-metric-value">{fmtPct(f.tey)}</span>
              </div>
              <div className="by-fund-metric">
                <span className="by-metric-label">Eff. Tax Rate</span>
                <span className="by-metric-value">{fmtPct(f.applicableRate * 100, 1)}</span>
              </div>
              {f.allocDollar > 0 && (
                <div className="by-fund-metric">
                  <span className="by-metric-label">After-Tax Income</span>
                  <span className="by-metric-value" style={{ color: 'var(--pos)' }}>{fmtMoney2(f.netIncome)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* ── Portfolio Summary ── */}
      {funds.length > 0 && portfolio.totalAllocPct > 0 && (
        <>
          <h2 className="by-section-title">Portfolio Summary</h2>

          {Math.abs(portfolio.totalAllocPct - 100) > 0.1 && (
            <div className="by-warning">
              Allocation totals {fmtPct(portfolio.totalAllocPct, 1)} — should equal 100%.
            </div>
          )}

          <div className="by-stat-row">
            <div className="by-stat">
              <div className="by-stat-label">Blended Yield (TEY)</div>
              <div className="by-stat-value">{fmtPct(portfolio.blendedTEY)}</div>
            </div>
            <div className="by-stat">
              <div className="by-stat-label">After-Tax Yield</div>
              <div className="by-stat-value">{fmtPct(portfolio.blendedATY)}</div>
            </div>
            <div className="by-stat">
              <div className="by-stat-label">Gross Yield</div>
              <div className="by-stat-value">{fmtPct(portfolio.blendedGross)}</div>
            </div>
            <div className="by-stat">
              <div className="by-stat-label">Annual Income</div>
              <div className="by-stat-value">{fmtMoney(portfolio.totalGrossIncome)}</div>
            </div>
            <div className="by-stat">
              <div className="by-stat-label">After-Tax Annual</div>
              <div className="by-stat-value" style={{ color: 'var(--pos)' }}>{fmtMoney(portfolio.totalNetIncome)}</div>
            </div>
            <div className="by-stat">
              <div className="by-stat-label">After-Tax Monthly</div>
              <div className="by-stat-value" style={{ color: 'var(--pos)' }}>{fmtMoney(Math.round(portfolio.totalNetIncome / 12))}</div>
            </div>
          </div>

          <div className="by-alloc-bar">
            {fundMetrics.filter(f => f.allocPct > 0).map(f => (
              <div key={f.id} className="by-alloc-seg"
                style={{ width: `${(f.allocPct / portfolio.totalAllocPct) * 100}%`, backgroundColor: f.color }}
                title={`${f.ticker}: ${fmtPct(f.allocPct, 1)}`}>
                {f.allocPct >= 8 && <span>{f.ticker}</span>}
              </div>
            ))}
          </div>

          <div className="by-alloc-legend">
            {fundMetrics.filter(f => f.allocPct > 0).map(f => (
              <span key={f.id} className="by-alloc-legend-item" title={`${f.ticker}: ${fmtPct(f.allocPct, 1)}`}>
                <span className="by-alloc-swatch" style={{ backgroundColor: f.color }} />
                <span className="by-alloc-legend-ticker">{f.ticker}</span>
                <span className="by-alloc-legend-pct">{fmtPct(f.allocPct, 1)}</span>
              </span>
            ))}
          </div>

          <div className="by-table-card">
            <table className="by-table">
              <thead>
                <tr>
                  <th title="Fund ticker symbol and name">Fund</th>
                  <th title="Stated distribution (gross) yield, before any taxes">Yield</th>
                  <th title="How this fund's distributions are taxed (e.g. fully taxable, treasury, municipal, return of capital, qualified/LTCG)">Tax Type</th>
                  <th title="Effective tax rate applied to this fund's distributions, based on your tax profile">Tax Rate</th>
                  <th title="After-Tax Yield — the yield you actually keep after taxes on this fund's distributions">ATY</th>
                  <th title="Tax-Equivalent Yield — the gross yield a fully-taxable fund would need to match this fund's after-tax yield">TEY</th>
                  <th title="This fund's share of the total portfolio, as a percent">Alloc %</th>
                  <th title="Dollar amount allocated to this fund">Allocation</th>
                  <th title="Estimated number of shares (allocation ÷ latest share price)">Shares</th>
                  <th title="Estimated gross annual income (allocation × yield), before taxes">Annual Income</th>
                  <th title="Estimated annual income from this fund after taxes">After-Tax</th>
                </tr>
              </thead>
              <tbody>
                {fundMetrics.filter(f => f.allocPct > 0).map(f => (
                  <tr key={f.id}>
                    <td>
                      <span style={{ color: f.color, fontWeight: 700 }}>{f.ticker}</span>
                      {f.name && <span className="by-muted by-fund-name-cell"> {f.name}</span>}
                    </td>
                    <td>{fmtPct(f.yieldPct)}</td>
                    <td>{shortTaxLabel(f.taxType, state.abbr)}</td>
                    <td>{fmtPct(f.applicableRate * 100, 1)}</td>
                    <td>{fmtPct(f.aty)}</td>
                    <td className="by-tey-cell">{fmtPct(f.tey)}</td>
                    <td>{fmtPct(f.allocPct, 1)}</td>
                    <td>{fmtMoney(f.allocDollar)}</td>
                    <td>{fmtShares(f.shares)}</td>
                    <td>{fmtMoney2(f.grossIncome)}</td>
                    <td style={{ color: 'var(--pos)' }}>{fmtMoney2(f.netIncome)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>Portfolio Blended</strong></td>
                  <td><strong>{fmtPct(portfolio.blendedATY)}</strong></td>
                  <td className="by-tey-cell"><strong>{fmtPct(portfolio.blendedTEY)}</strong></td>
                  <td><strong>{fmtPct(portfolio.totalAllocPct, 1)}</strong></td>
                  <td><strong>{fmtMoney(totalInvestment)}</strong></td>
                  <td><strong>{fmtShares(portfolio.totalShares)}</strong></td>
                  <td><strong>{fmtMoney2(portfolio.totalGrossIncome)}</strong></td>
                  <td style={{ color: 'var(--pos)' }}><strong>{fmtMoney2(portfolio.totalNetIncome)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="by-disclaimer">
            Yields are approximate as of early 2025 — verify current yields from your broker.
            Tax brackets are 2025 estimates. Consult a tax professional for your specific situation.
            NIIT (3.8% surtax) is not included.
          </div>
        </>
      )}
    </div>
  )
}

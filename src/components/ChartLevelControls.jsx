import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ALL_PERCENT_LEVEL_KEYS,
  CUSTOM_PERCENT_LEVELS,
  MAX_CUSTOM_DOWNSIDE_PCT,
  MAX_CUSTOM_UPSIDE_PCT,
  MAX_SR_PER_SIDE,
  PERCENT_LEVEL_BASES,
  PERCENT_LEVEL_OPTIONS,
  SR_SIDE_OPTIONS,
  customPercentLevelPct,
  levelDistanceLabel,
  percentLevelColor,
  percentLevelLabel,
  srColorLabels,
  srLevelColor,
} from '../utils/priceLevels'
import { ALL_PATTERN_KEYS, PATTERN_GROUPS, PATTERN_TYPES } from '../utils/chartPatterns'
import { ALL_CANDLE_PATTERN_KEYS, CANDLE_MIN_ODDS_OPTIONS, CANDLE_PATTERN_SOURCE, CANDLE_PATTERN_TYPES } from '../utils/candlestickPatterns'
import { formatMoney } from '../utils/money'

// A toggle button with an attached ▾ menu. The main button turns the overlay on/off
// with one click; the caret opens its settings.
function ToggleWithMenu({ label, title, active, onToggle, menuTitle, menuClassName = '', children }) {
  const [open, setOpen] = useState(false)
  const [openRight, setOpenRight] = useState(false)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)

  // The menu hangs left from the button's right edge; when the toolbar wraps and the
  // button sits near the window's left edge, that would run off screen, so it opens
  // rightward from the button instead.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    if (menuRef.current.getBoundingClientRect().left < 8) setOpenRight(true)
  }, [open])
  const toggleOpen = () => {
    setOpenRight(false)
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="etf-level-control" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-sm etf-level-main${active ? ' btn-active' : ''}`}
        onClick={onToggle}
        title={title}
        aria-pressed={active}
      >{label}</button>
      <button
        type="button"
        className={`btn btn-sm etf-level-caret${active ? ' btn-active' : ''}`}
        onClick={toggleOpen}
        title={menuTitle}
        aria-haspopup="true"
        aria-expanded={open}
      >▾</button>
      {open && (
        <div
          ref={menuRef}
          className={`etf-level-menu ${menuClassName}${openRight ? ' etf-level-menu--right' : ''}`}
          role="menu"
        >{children}</div>
      )}
    </span>
  )
}

// A small color input for one level line, in the same style for every menu.
function LevelColorInput({ value, onChange, label }) {
  return (
    <input
      type="color"
      className="etf-draw-color etf-level-color"
      value={value.toLowerCase()}
      onChange={e => onChange(e.target.value)}
      aria-label={`${label} line color`}
      title={`${label} line color`}
    />
  )
}

// The custom row for one side: color, checkbox, and a box to type the size of the move.
// The draft text is kept apart from the saved value so a half-typed "7." stays put;
// leaving the box shows the saved size again.
function CustomLevelRow({ def, pct, checked, onToggle, onChangePct, color, onChangeColor }) {
  const sign = def.side === 'up' ? '+' : '-'
  const size = String(Math.abs(pct))
  const max = def.side === 'up' ? MAX_CUSTOM_UPSIDE_PCT : MAX_CUSTOM_DOWNSIDE_PCT
  const [draft, setDraft] = useState(size)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(size) }, [size])
  const invalid = customPercentLevelPct(def.key, draft) == null
  const label = `Custom ${percentLevelLabel(pct)}`

  return (
    <div className="etf-level-option etf-level-color-row etf-level-custom-row">
      <LevelColorInput value={color} onChange={onChangeColor} label={label} />
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Show the ${label} level`}
        title={`Show the ${label} level`}
      />
      <span className="etf-level-custom-sign">{sign}</span>
      <input
        type="text"
        inputMode="decimal"
        className={`etf-level-custom-input${invalid ? ' is-invalid' : ''}`}
        value={draft}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; setDraft(size) }}
        onChange={(e) => {
          setDraft(e.target.value)
          const next = customPercentLevelPct(def.key, e.target.value)
          if (next != null && next !== pct) onChangePct(next)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={`Custom ${def.side === 'up' ? 'upside' : 'downside'} percent`}
        title={`Type a ${def.side === 'up' ? 'rise' : 'drop'} of more than 0% and up to ${max}%`}
      />
      <span>%</span>
      <span className="etf-level-custom-tag">Custom</span>
    </div>
  )
}

export function PercentLevelsControl({
  active, onToggle, selectedKeys, onChangeKeys, base, onChangeBase, colors, onChangeColor, onResetColors,
  customPcts, onChangeCustomPct,
}) {
  const selected = new Set(selectedKeys)
  const toggleKey = (key) => {
    const next = selected.has(key) ? selectedKeys.filter(k => k !== key) : [...selectedKeys, key]
    onChangeKeys(next)
    if (!active && next.length) onToggle()
  }
  const upside = PERCENT_LEVEL_OPTIONS.filter(o => o.pct > 0)
  const downside = PERCENT_LEVEL_OPTIONS.filter(o => o.pct < 0)
  const customized = Object.keys(colors || {}).length > 0
  const renderOption = (opt) => (
    <div key={opt.key} className="etf-level-option etf-level-color-row">
      <LevelColorInput
        value={percentLevelColor(opt.key, colors)}
        onChange={color => onChangeColor(opt.key, color)}
        label={percentLevelLabel(opt.pct)}
      />
      <label className="etf-level-option">
        <input type="checkbox" checked={selected.has(opt.key)} onChange={() => toggleKey(opt.key)} />
        {percentLevelLabel(opt.pct)}
      </label>
    </div>
  )
  // Typing a new size turns that custom level on, as checking its box would.
  const renderCustom = (side) => {
    const def = CUSTOM_PERCENT_LEVELS.find(c => c.side === side)
    return (
      <CustomLevelRow
        key={def.key}
        def={def}
        pct={customPcts?.[def.key] ?? def.pct}
        checked={selected.has(def.key)}
        onToggle={() => toggleKey(def.key)}
        onChangePct={(pct) => {
          onChangeCustomPct(def.key, pct)
          if (!selected.has(def.key)) toggleKey(def.key)
        }}
        color={percentLevelColor(def.key, colors)}
        onChangeColor={color => onChangeColor(def.key, color)}
      />
    )
  }

  return (
    <ToggleWithMenu
      label="% Levels"
      title="Show / hide percent upside and downside levels"
      menuTitle="Choose which percent levels to show"
      active={active}
      onToggle={onToggle}
    >
      <div className="etf-level-menu-head">Upside</div>
      {upside.map(renderOption)}
      {renderCustom('up')}
      <div className="etf-level-menu-head">Downside</div>
      {downside.map(renderOption)}
      {renderCustom('down')}
      <div className="etf-level-menu-row">
        <button type="button" className="btn btn-sm" onClick={() => { onChangeKeys(ALL_PERCENT_LEVEL_KEYS); if (!active) onToggle() }}>All</button>
        <button type="button" className="btn btn-sm" onClick={() => onChangeKeys([])}>None</button>
        <button type="button" className="btn btn-sm" onClick={onResetColors} disabled={!customized}>Reset colors</button>
      </div>
      <label className="etf-level-menu-field">
        <span>Measured from</span>
        <select className="etf-draw-select" value={base} onChange={e => onChangeBase(e.target.value)}>
          {PERCENT_LEVEL_BASES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </label>
    </ToggleWithMenu>
  )
}

export function OffHighToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      className={`btn btn-sm${active ? ' btn-active' : ''}`}
      onClick={onToggle}
      title="Show / hide how far the last close is below the period's highest close"
      aria-pressed={active}
    >Off High</button>
  )
}

export function HighLowToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      className={`btn btn-sm${active ? ' btn-active' : ''}`}
      onClick={onToggle}
      title="Show / hide labels on the highest and lowest bars of the loaded period"
      aria-pressed={active}
    >Hi/Lo</button>
  )
}

// Chart patterns: one checkbox per pattern, each with its line color and, while the
// overlay is on, how many were found in the loaded period.
export function PatternsControl({ active, onToggle, selectedKeys, onChangeKeys, counts }) {
  const selected = new Set(selectedKeys)
  const toggleKey = (key) => {
    const next = selected.has(key) ? selectedKeys.filter(k => k !== key) : [...selectedKeys, key]
    onChangeKeys(next)
    if (!active && next.length) onToggle()
  }
  return (
    <ToggleWithMenu
      label="Patterns"
      title="Show / hide chart patterns found in the loaded period"
      menuTitle="Choose which chart patterns to look for"
      menuClassName="etf-pattern-menu"
      active={active}
      onToggle={onToggle}
    >
      {PATTERN_GROUPS.map(group => (
        <React.Fragment key={group}>
          <div className="etf-level-menu-head">{group}</div>
          {PATTERN_TYPES.filter(t => t.group === group).map(t => (
            <label key={t.key} className="etf-level-option etf-pattern-option">
              <span className="etf-pattern-swatch" style={{ background: t.color }} aria-hidden="true" />
              <input type="checkbox" checked={selected.has(t.key)} onChange={() => toggleKey(t.key)} />
              <span>{t.label}</span>
              {active && counts?.[t.key] > 0 && (
                <span className="etf-pattern-count" title="Found in the loaded period">{counts[t.key]}</span>
              )}
              {active && !counts?.[t.key] && selected.has(t.key) && (
                <span className="etf-pattern-count is-none" title="Not found in the loaded period">not found</span>
              )}
            </label>
          ))}
        </React.Fragment>
      ))}
      <div className="etf-level-menu-row">
        <button type="button" className="btn btn-sm" onClick={() => { onChangeKeys([...ALL_PATTERN_KEYS]); if (!active) onToggle() }}>All</button>
        <button type="button" className="btn btn-sm" onClick={() => onChangeKeys([])}>None</button>
      </div>
      <p className="etf-level-menu-note">
        Found automatically in the loaded period and redrawn whenever the ticker, period
        or bar size changes. Solid lines: the pattern broke out the way it points. Dotted:
        still forming. Dashed: it broke the other way. Hover a label for details.
      </p>
    </ToggleWithMenu>
  )
}

// The line above the chart (never over it) while Patterns is on: the ticked patterns
// that were not found in the loaded period. It lists ticked patterns only, so
// unticking one drops it from the line, and with none missing the line is gone. With
// nothing ticked (how it starts) it says so, and how many were found.
export function PatternsStatus({ selectedKeys, counts }) {
  const ticked = PATTERN_TYPES.filter(t => selectedKeys.includes(t.key))
  if (!ticked.length) {
    const found = Object.values(counts || {}).reduce((a, b) => a + b, 0)
    return (
      <div className="etf-pattern-status" role="status">
        <span>
          <strong>Patterns:</strong> None are ticked yet.{' '}
          {found
            ? `${found} found in the loaded period; tick the ones to show in the ▾ menu beside Patterns.`
            : 'None were found in the loaded period either. Tick the ones to look for in the ▾ menu beside Patterns.'}
        </span>
      </div>
    )
  }
  const missing = ticked.filter(t => !counts?.[t.key])
  if (!missing.length) return null
  const noneFound = missing.length === ticked.length
  if (noneFound && ticked.length > 3) {
    return (
      <div className="etf-pattern-status" role="status">
        <span>
          <strong>None of the {ticked.length} ticked patterns were found in the loaded period.</strong>
          {' '}A longer period or a different bar size may show some.
        </span>
      </div>
    )
  }
  return (
    <div className="etf-pattern-status" role="status">
      <span>
        <strong>{missing.length === 1 ? 'Pattern not found' : 'Patterns not found'} in the loaded period:</strong>
        {' '}
        {missing.map((t, i) => (
          <span key={t.key} className="etf-pattern-chip">
            <span className="etf-pattern-swatch" style={{ background: t.color }} aria-hidden="true" />
            {t.label}{i < missing.length - 1 ? ',' : '.'}
          </span>
        ))}
        {noneFound && ' A longer period or a different bar size may show some.'}
      </span>
    </div>
  )
}

// Candlestick patterns: one checkbox per pattern, bullish then bearish, each with its
// chart code, its odds (published, blended with this chart's record once found) and,
// while the overlay is on, how many were found in the loaded period.
export function CandlePatternsControl({
  active, onToggle, selectedKeys, onChangeKeys, minOdds, onChangeMinOdds, stats,
}) {
  const selected = new Set(selectedKeys)
  const setKeys = (keys) => {
    onChangeKeys(keys)
    if (!active && keys.length) onToggle()
  }
  const toggleKey = (key) => setKeys(selected.has(key) ? selectedKeys.filter(k => k !== key) : [...selectedKeys, key])
  const keysFor = (bias) => CANDLE_PATTERN_TYPES.filter(t => t.bias === bias).map(t => t.key)
  return (
    <ToggleWithMenu
      label="Candle Patterns"
      title="Show / hide candlestick patterns found in the loaded period"
      menuTitle="Choose which candlestick patterns to look for"
      menuClassName="etf-candle-menu"
      active={active}
      onToggle={onToggle}
    >
      {[['bullish', 'Bullish ▲'], ['bearish', 'Bearish ▼']].map(([bias, head]) => (
        <React.Fragment key={bias}>
          <div className="etf-level-menu-head etf-candle-head">
            <span>{head}</span>
            <span className="etf-candle-col">Odds</span>
            <span className="etf-candle-col etf-candle-found">Found</span>
          </div>
          {CANDLE_PATTERN_TYPES.filter(t => t.bias === bias).map(t => {
            const s = active ? stats?.[t.key] : null
            const odds = s ? s.oddsPct : t.published
            const oddsTitle = s
              ? `Chance of the expected move on this chart: ${Math.round(odds)}%. Published tests ${t.published}%`
                + (s.resolved ? `; here ${s.wins} of ${s.resolved} played out.` : '; none has played out here yet.')
              : `Published tests: ${t.published}% (${t.study.toLowerCase()}).`
            return (
              <label key={t.key} className="etf-level-option etf-candle-option" title={`${t.label}: ${t.signal.toLowerCase()}`}>
                <input type="checkbox" checked={selected.has(t.key)} onChange={() => toggleKey(t.key)} />
                <span className="etf-candle-code" style={{ color: t.color, borderColor: t.color }}>{t.arrow}{t.code}</span>
                <span className="etf-candle-name">{t.label}</span>
                <span className={`etf-candle-col etf-candle-odds${odds < 50 ? ' is-weak' : ''}`} title={oddsTitle}>
                  {Math.round(odds)}%
                </span>
                <span className="etf-candle-col etf-candle-found etf-pattern-count">
                  {active && s?.count ? s.count : active && selected.has(t.key) ? '–' : ''}
                </span>
              </label>
            )
          })}
        </React.Fragment>
      ))}
      <div className="etf-level-menu-row">
        <button type="button" className="btn btn-sm" onClick={() => setKeys([...ALL_CANDLE_PATTERN_KEYS])}>All</button>
        <button type="button" className="btn btn-sm" onClick={() => onChangeKeys([])}>None</button>
        <button type="button" className="btn btn-sm" onClick={() => setKeys(keysFor('bullish'))}>Bullish</button>
        <button type="button" className="btn btn-sm" onClick={() => setKeys(keysFor('bearish'))}>Bearish</button>
      </div>
      <label className="etf-level-menu-field">
        <span>Only show odds of at least</span>
        <select className="etf-draw-select" value={minOdds} onChange={e => onChangeMinOdds(Number(e.target.value))}>
          {CANDLE_MIN_ODDS_OPTIONS.map(v => <option key={v} value={v}>{v ? `${v}%` : 'Any'}</option>)}
        </select>
      </label>
      <p className="etf-level-menu-note">
        Odds are the chance of the expected move: a close above the pattern&apos;s high (bullish) or below
        its low (bearish) before a close beyond its other side. They start from published test results
        ({CANDLE_PATTERN_SOURCE}) and lean toward how each pattern did earlier on this chart. Under 50%
        means tests found it more often went the other way. Hover a label on the chart for details.
        Past results, not a forecast.
      </p>
    </ToggleWithMenu>
  )
}

// The line above the chart (never over it) when Candle Patterns is on but draws
// nothing: none ticked, none found, or none with the minimum odds.
export function CandlePatternsStatus({ selectedKeys, finds, shownCount, minOdds }) {
  if (shownCount > 0) return null
  const ticked = finds.filter(f => selectedKeys.includes(f.key))
  let text
  if (!selectedKeys.length) {
    text = finds.length
      ? `None are ticked yet. ${finds.length} found in the loaded period; tick the ones to show in the ▾ menu beside Candle Patterns.`
      : 'None are ticked yet, and none were found in the loaded period. Tick the ones to look for in the ▾ menu beside Candle Patterns.'
  }
  else if (!ticked.length) text = 'None of the ticked candlestick patterns were found in the loaded period. A longer period or a different bar size may show some.'
  else text = `${ticked.length} ticked candlestick pattern${ticked.length === 1 ? ' was' : 's were'} found, but none with odds of at least ${minOdds}%.`
  return (
    <div className="etf-pattern-status" role="status">
      <span><strong>Candle Patterns:</strong> {text}</span>
    </div>
  )
}

export function SupportResistanceControl({
  active, onToggle, perSide, onChangePerSide, sides, onChangeSides, colors, onChangeColor, onResetColors, levels,
}) {
  // Current levels by label, so each color row can show its price and distance.
  const byLabel = {}
  if (levels) [...levels.support, ...levels.resistance].forEach(l => { byLabel[l.label] = l })
  const customized = Object.keys(colors || {}).length > 0

  return (
    <ToggleWithMenu
      label="S/R"
      title="Show / hide support and resistance levels"
      menuTitle="Support / resistance settings"
      active={active}
      onToggle={onToggle}
    >
      <label className="etf-level-menu-field">
        <span>Levels per side</span>
        <select className="etf-draw-select" value={perSide} onChange={e => onChangePerSide(Number(e.target.value))}>
          {Array.from({ length: MAX_SR_PER_SIDE }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="etf-level-menu-field">
        <span>Show</span>
        <select className="etf-draw-select" value={sides} onChange={e => onChangeSides(e.target.value)}>
          {SR_SIDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="etf-level-menu-head">Line colors</div>
      {srColorLabels(perSide, sides).map(label => {
        const lvl = byLabel[label]
        return (
          <div key={label} className="etf-level-option etf-level-color-row">
            <LevelColorInput
              value={srLevelColor(label, colors)}
              onChange={color => onChangeColor(label, color)}
              label={label}
            />
            <span className="etf-sr-color-label">{label}</span>
            <span className="etf-sr-color-detail">
              {lvl
                ? `${formatMoney(lvl.price)} · ${levelDistanceLabel(lvl.pctFromClose).replace(' from close', '')}`
                : active ? 'none found' : ''}
            </span>
          </div>
        )
      })}
      <div className="etf-level-menu-row">
        <button type="button" className="btn btn-sm" onClick={onResetColors} disabled={!customized}>Reset colors</button>
      </div>
      <p className="etf-level-menu-note">
        Support (S, green by default) is below the last close; resistance (R, red by
        default) is above it. Each label shows how far the last close has to fall (or
        rise) to reach the level. Levels come from clustered swing highs and lows in the
        loaded period, and the shaded band shows the price zone where those swings sat.
      </p>
      <p className="etf-level-menu-note">
        A level price is sitting on is marked <em>testing</em>: support if price fell into
        it, resistance if it rose into it. If the period runs out of levels on a side
        (say, price breaks to a new low), older levels from a longer history fill in,
        drawn dotted with the date they were last touched.
      </p>
    </ToggleWithMenu>
  )
}

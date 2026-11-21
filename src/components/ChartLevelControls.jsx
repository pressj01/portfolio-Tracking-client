import React, { useEffect, useRef, useState } from 'react'
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
import { formatMoney } from '../utils/money'

// A toggle button with an attached ▾ menu. The main button turns the overlay on/off
// with one click; the caret opens its settings.
function ToggleWithMenu({ label, title, active, onToggle, menuTitle, children }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

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
        onClick={() => setOpen(o => !o)}
        title={menuTitle}
        aria-haspopup="true"
        aria-expanded={open}
      >▾</button>
      {open && <div className="etf-level-menu" role="menu">{children}</div>}
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

"""Options Trading Tools API.

Endpoints:
  GET  /api/options/quote?ticker=SPY
  GET  /api/options/expirations?ticker=SPY
  GET  /api/options/chain?ticker=SPY&expiration=2026-06-19
  POST /api/options/risk-graph
  GET  /api/options/strategies
  GET  /api/options/strategies/<id>
  POST /api/options/strategies
  PUT  /api/options/strategies/<id>
  DELETE /api/options/strategies/<id>
"""

from __future__ import annotations

import math
import time
from datetime import datetime, date
from typing import Any

import yfinance as yf
from flask import jsonify, request

from config import get_connection
from options_pricing import price_option, black_scholes

# ---------------------------------------------------------------------------
# Caches (in-memory, TTL)
# ---------------------------------------------------------------------------

_QUOTE_TTL = 30          # seconds
_EXP_TTL = 300           # 5 min
_CHAIN_TTL = 30          # seconds

_quote_cache: dict[str, tuple[float, dict]] = {}
_exp_cache: dict[str, tuple[float, list[str]]] = {}
_chain_cache: dict[tuple[str, str], tuple[float, dict]] = {}


def _now() -> float:
    return time.time()


def _cache_get(cache: dict, key, ttl: int):
    entry = cache.get(key)
    if entry and (_now() - entry[0]) < ttl:
        return entry[1]
    return None


def _cache_set(cache: dict, key, value):
    cache[key] = (_now(), value)


# ---------------------------------------------------------------------------
# yfinance helpers
# ---------------------------------------------------------------------------

def _safe(v, default=None):
    try:
        if v is None:
            return default
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return default
        return v
    except Exception:
        return default


def _year_frac(exp_str: str, eval_d: date | None = None) -> float:
    eval_d = eval_d or date.today()
    try:
        exp_d = datetime.strptime(exp_str, "%Y-%m-%d").date()
    except ValueError:
        return 0.0
    days = (exp_d - eval_d).days
    # Option expires at close on expiration date -> use max(days, 0) with a small floor for same-day
    return max(days, 0) / 365.0


def _fetch_quote(ticker: str) -> dict:
    cached = _cache_get(_quote_cache, ticker, _QUOTE_TTL)
    if cached:
        return cached
    t = yf.Ticker(ticker)

    def _get_fi(attr):
        try:
            fi = t.fast_info
            v = getattr(fi, attr, None)
            if v is None and hasattr(fi, '__getitem__'):
                try:
                    v = fi[attr]
                except Exception:
                    v = None
            return _safe(v)
        except Exception:
            return None

    last = _get_fi('last_price')
    bid = _get_fi('bid')
    ask = _get_fi('ask')
    prev = _get_fi('previous_close')
    vol = _get_fi('last_volume')
    open_ = _get_fi('open')
    high = _get_fi('day_high')
    low = _get_fi('day_low')

    # Fallback: pull last close from recent history if fast_info is empty
    if last is None:
        try:
            hist = t.history(period='5d', auto_adjust=False)
            if not hist.empty:
                last = float(hist['Close'].iloc[-1])
                if prev is None and len(hist) >= 2:
                    prev = float(hist['Close'].iloc[-2])
                if open_ is None:
                    open_ = float(hist['Open'].iloc[-1])
                if high is None:
                    high = float(hist['High'].iloc[-1])
                if low is None:
                    low = float(hist['Low'].iloc[-1])
                if vol is None:
                    vol = int(hist['Volume'].iloc[-1])
        except Exception:
            pass

    # Dividend yield + name from slow info
    div_yield = 0.0
    name = None
    try:
        slow = t.info or {}
        name = slow.get('shortName') or slow.get('longName')
        dy = _safe(slow.get('dividendYield'))
        if dy is not None:
            dy = float(dy)
            # yfinance inconsistency: sometimes 0.0150 (decimal), sometimes 1.50 (percent)
            div_yield = dy / 100.0 if dy > 1.0 else dy
    except Exception:
        pass

    result = {
        'ticker': ticker.upper(),
        'name': name,
        'last': last,
        'bid': bid,
        'ask': ask,
        'prev_close': prev,
        'change': (last - prev) if (last is not None and prev is not None) else None,
        'change_pct': ((last - prev) / prev * 100.0) if (last and prev) else None,
        'volume': vol,
        'open': open_,
        'high': high,
        'low': low,
        'div_yield': div_yield,
    }
    _cache_set(_quote_cache, ticker, result)
    return result


def _fetch_expirations(ticker: str) -> list[str]:
    cached = _cache_get(_exp_cache, ticker, _EXP_TTL)
    if cached:
        return cached
    t = yf.Ticker(ticker)
    try:
        exps = list(t.options or [])
    except Exception:
        exps = []
    _cache_set(_exp_cache, ticker, exps)
    return exps


def _fetch_chain(ticker: str, expiration: str) -> dict:
    key = (ticker.upper(), expiration)
    cached = _cache_get(_chain_cache, key, _CHAIN_TTL)
    if cached:
        return cached

    t = yf.Ticker(ticker)
    chain = t.option_chain(expiration)

    quote = _fetch_quote(ticker)
    spot = quote.get('last') or quote.get('ask') or 0.0
    r = 0.0375
    q = quote.get('div_yield') or 0.0
    T = _year_frac(expiration)

    def _row(df_row, opt_type: str) -> dict:
        strike = float(df_row.get('strike') or 0.0)
        bid = _safe(df_row.get('bid'), 0.0) or 0.0
        ask = _safe(df_row.get('ask'), 0.0) or 0.0
        last = _safe(df_row.get('lastPrice'), 0.0) or 0.0
        iv = _safe(df_row.get('impliedVolatility'), 0.0) or 0.0
        vol = _safe(df_row.get('volume'), 0)
        oi = _safe(df_row.get('openInterest'), 0)
        mid = (bid + ask) / 2.0 if (bid and ask) else last

        delta = None
        prob_otm = None
        if iv > 0 and T > 0 and spot > 0:
            try:
                g = black_scholes(spot, strike, T, r, q, iv, opt_type)
                delta = g['delta']
                # Prob OTM ≈ 1 - |delta| (first-order approximation used by TOS display)
                prob_otm = max(0.0, min(1.0, 1.0 - abs(delta)))
            except Exception:
                pass

        return {
            'strike': strike,
            'bid': bid,
            'ask': ask,
            'mid': mid,
            'last': last,
            'iv': iv,
            'volume': int(vol) if vol is not None else 0,
            'open_interest': int(oi) if oi is not None else 0,
            'delta': delta,
            'prob_otm': prob_otm,
        }

    calls = [_row(r_, 'call') for _, r_ in chain.calls.iterrows()]
    puts = [_row(r_, 'put') for _, r_ in chain.puts.iterrows()]

    result = {
        'ticker': ticker.upper(),
        'expiration': expiration,
        'spot': spot,
        'div_yield': q,
        'rate': r,
        'T': T,
        'calls': calls,
        'puts': puts,
    }
    _cache_set(_chain_cache, key, result)
    return result


# ---------------------------------------------------------------------------
# Risk graph math
# ---------------------------------------------------------------------------

def _leg_pnl_at(S: float, leg: dict, eval_T_years: float, r: float, q: float,
                model: str) -> tuple[float, dict]:
    """Return (per-contract P/L at spot S, Greeks) for a single leg.

    P/L per contract = 100 * (current_theo - entry_price) * sign
    Total leg P/L    = qty * per-contract-pl
    """
    sign = 1.0 if leg['side'].upper() == 'BUY' else -1.0
    K = float(leg['strike'])
    sigma = float(leg['iv'])
    opt_type = leg['opt_type'].lower()
    entry = float(leg.get('entry_price') or 0.0)

    if eval_T_years <= 1e-8:
        theo = max(S - K, 0.0) if opt_type == 'call' else max(K - S, 0.0)
        greeks = {'delta': 0.0, 'gamma': 0.0, 'theta': 0.0, 'vega': 0.0, 'rho': 0.0}
    else:
        res = price_option(S, K, eval_T_years, r, q, max(sigma, 1e-4), opt_type, model)
        theo = res['price']
        greeks = {k: res[k] for k in ('delta', 'gamma', 'theta', 'vega', 'rho')}

    pnl_per_contract = 100.0 * (theo - entry) * sign
    return pnl_per_contract, greeks


# ---------------------------------------------------------------------------
# Route registration
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route('/api/options/quote', methods=['GET'])
    def options_quote():
        ticker = (request.args.get('ticker') or '').strip().upper()
        if not ticker:
            return jsonify(error='ticker required'), 400
        try:
            return jsonify(_fetch_quote(ticker))
        except Exception as e:
            return jsonify(error=str(e)), 500

    @app.route('/api/options/expirations', methods=['GET'])
    def options_expirations():
        ticker = (request.args.get('ticker') or '').strip().upper()
        if not ticker:
            return jsonify(error='ticker required'), 400
        try:
            exps = _fetch_expirations(ticker)
            return jsonify(ticker=ticker, expirations=exps)
        except Exception as e:
            return jsonify(error=str(e)), 500

    @app.route('/api/options/chain', methods=['GET'])
    def options_chain():
        ticker = (request.args.get('ticker') or '').strip().upper()
        expiration = (request.args.get('expiration') or '').strip()
        if not ticker or not expiration:
            return jsonify(error='ticker and expiration required'), 400
        try:
            return jsonify(_fetch_chain(ticker, expiration))
        except Exception as e:
            return jsonify(error=str(e)), 500

    @app.route('/api/options/risk-graph', methods=['POST'])
    def options_risk_graph():
        payload = request.get_json(force=True) or {}
        underlying = (payload.get('underlying') or '').strip().upper()
        if not underlying:
            return jsonify(error='underlying required'), 400

        legs_in = payload.get('legs') or []
        if not legs_in:
            return jsonify(error='at least one leg required'), 400

        model = payload.get('model') or 'black-scholes'
        r = float(payload.get('rate') if payload.get('rate') is not None else 0.0375)

        quote = _fetch_quote(underlying)
        spot = float(payload.get('spot_override') or quote.get('last') or 0.0)
        q = float(payload.get('div_yield') if payload.get('div_yield') is not None else (quote.get('div_yield') or 0.0))

        eval_date_str = payload.get('eval_date')
        eval_d = datetime.strptime(eval_date_str, '%Y-%m-%d').date() if eval_date_str else date.today()

        # Price range
        pr = payload.get('price_range') or {}
        low = float(pr.get('low') or spot * 0.80)
        high = float(pr.get('high') or spot * 1.10)
        steps = int(pr.get('steps') or 120)
        if steps < 5:
            steps = 5
        if steps > 500:
            steps = 500
        if high <= low:
            high = low + 1.0

        # Precompute per-leg T for today (eval_date) and expiration
        legs: list[dict] = []
        for leg in legs_in:
            exp = leg.get('expiration')
            iv = float(leg.get('iv') if leg.get('iv') is not None else (leg.get('iv_override') or 0.0))
            entry = float(leg.get('entry_price') if leg.get('entry_price') is not None else 0.0)
            legs.append({
                'side': leg.get('side', 'BUY').upper(),
                'qty': int(leg.get('qty') or 1),
                'opt_type': (leg.get('opt_type') or leg.get('type') or 'CALL').lower(),
                'strike': float(leg.get('strike') or 0.0),
                'expiration': exp,
                'iv': iv,
                'entry_price': entry,
                'T_today': _year_frac(exp, eval_d),
                'T_exp': 0.0,
            })

        # Scenario price grid
        dx = (high - low) / (steps - 1)
        prices = [low + i * dx for i in range(steps)]

        today_curve = []
        exp_curve = []

        for S in prices:
            pnl_today = 0.0
            pnl_exp = 0.0
            for leg in legs:
                pnl_t, _ = _leg_pnl_at(S, leg, leg['T_today'], r, q, model)
                pnl_today += leg['qty'] * pnl_t
                pnl_e, _ = _leg_pnl_at(S, leg, leg['T_exp'], r, q, model)
                pnl_exp += leg['qty'] * pnl_e
            today_curve.append({'s': round(S, 4), 'pnl': round(pnl_today, 2)})
            exp_curve.append({'s': round(S, 4), 'pnl': round(pnl_exp, 2)})

        # Portfolio Greeks at current spot (today)
        port_greeks = {'delta': 0.0, 'gamma': 0.0, 'theta': 0.0, 'vega': 0.0, 'rho': 0.0}
        per_leg = []
        for leg in legs:
            pnl_t, g = _leg_pnl_at(spot, leg, leg['T_today'], r, q, model)
            sign = 1.0 if leg['side'] == 'BUY' else -1.0
            for k in port_greeks:
                port_greeks[k] += sign * leg['qty'] * g[k] * 100.0
            per_leg.append({
                'side': leg['side'],
                'qty': leg['qty'],
                'opt_type': leg['opt_type'],
                'strike': leg['strike'],
                'expiration': leg['expiration'],
                'iv': leg['iv'],
                'entry_price': leg['entry_price'],
                'theo_pnl_today': round(leg['qty'] * pnl_t, 2),
                'delta': round(sign * g['delta'], 4),
                'gamma': round(sign * g['gamma'], 6),
                'theta': round(sign * g['theta'], 4),
                'vega': round(sign * g['vega'], 4),
            })

        # Breakevens: sign-change zero crossings on expiration curve
        breakevens = []
        for i in range(1, len(exp_curve)):
            y0 = exp_curve[i - 1]['pnl']
            y1 = exp_curve[i]['pnl']
            if y0 == 0:
                breakevens.append(exp_curve[i - 1]['s'])
            elif (y0 < 0) != (y1 < 0):
                x0 = exp_curve[i - 1]['s']
                x1 = exp_curve[i]['s']
                # linear interp
                be = x0 + (0 - y0) * (x1 - x0) / (y1 - y0) if y1 != y0 else x0
                breakevens.append(round(be, 2))

        max_profit = max(p['pnl'] for p in exp_curve)
        max_loss = min(p['pnl'] for p in exp_curve)

        # Price slices: 3 scenarios (-10%, 0%, +10%) by default; user can override on client
        slice_requests = payload.get('price_slices') or [
            {'s': spot * 0.95},
            {'s': spot},
            {'s': spot * 1.10},
        ]
        slices_out = []
        for sreq in slice_requests:
            S_ = float(sreq.get('s') or spot)
            pnl_today = 0.0
            pnl_day = 0.0  # delta-P/L over 1 day = total theta aggregated
            port = {'delta': 0.0, 'gamma': 0.0, 'theta': 0.0, 'vega': 0.0}
            for leg in legs:
                pnl_t, g = _leg_pnl_at(S_, leg, leg['T_today'], r, q, model)
                sign = 1.0 if leg['side'] == 'BUY' else -1.0
                pnl_today += leg['qty'] * pnl_t
                for k in port:
                    port[k] += sign * leg['qty'] * g[k] * 100.0
            slices_out.append({
                's': round(S_, 2),
                'delta': round(port['delta'], 4),
                'gamma': round(port['gamma'], 6),
                'theta': round(port['theta'], 4),
                'vega': round(port['vega'], 4),
                'pnl_open': round(pnl_today, 2),
                'pnl_day': round(port['theta'], 2),  # 1-day approx
            })

        return jsonify({
            'underlying': underlying,
            'spot': spot,
            'eval_date': eval_d.isoformat(),
            'model': model,
            'rate': r,
            'div_yield': q,
            'curves': {
                'today': today_curve,
                'expiration': exp_curve,
            },
            'portfolio_greeks': {k: round(v, 4) for k, v in port_greeks.items()},
            'per_leg': per_leg,
            'breakevens': breakevens,
            'max_profit': round(max_profit, 2),
            'max_loss': round(max_loss, 2),
            'price_slices': slices_out,
        })

    # ────────────────────────────────────────────────────────────────
    # Strategy CRUD
    # ────────────────────────────────────────────────────────────────

    def _serialize_strategy(row, legs) -> dict:
        return {
            'id': row['id'],
            'name': row['name'],
            'underlying': row['underlying'],
            'model': row['model'],
            'rate': row['rate'],
            'notes': row['notes'],
            'created_date': row['created_date'],
            'updated_date': row['updated_date'],
            'legs': [dict(leg) for leg in legs],
        }

    @app.route('/api/options/strategies', methods=['GET'])
    def list_strategies():
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM option_strategies ORDER BY updated_date DESC"
            ).fetchall()
            out = []
            for row in rows:
                legs = conn.execute(
                    "SELECT * FROM option_strategy_legs WHERE strategy_id=? ORDER BY sort_order, id",
                    (row['id'],)
                ).fetchall()
                out.append(_serialize_strategy(row, legs))
            return jsonify(out)
        finally:
            conn.close()

    @app.route('/api/options/strategies/<int:sid>', methods=['GET'])
    def get_strategy(sid):
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM option_strategies WHERE id=?", (sid,)
            ).fetchone()
            if not row:
                return jsonify(error='not found'), 404
            legs = conn.execute(
                "SELECT * FROM option_strategy_legs WHERE strategy_id=? ORDER BY sort_order, id",
                (sid,)
            ).fetchall()
            return jsonify(_serialize_strategy(row, legs))
        finally:
            conn.close()

    def _insert_legs(conn, sid: int, legs: list[dict]):
        for i, leg in enumerate(legs):
            conn.execute("""
                INSERT INTO option_strategy_legs
                (strategy_id, group_id, included, side, qty, opt_type, strike,
                 expiration, entry_price, iv_override, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sid,
                int(leg.get('group_id', 0)),
                1 if leg.get('included', True) else 0,
                (leg.get('side') or 'BUY').upper(),
                int(leg.get('qty') or 1),
                (leg.get('opt_type') or 'CALL').upper(),
                float(leg.get('strike') or 0.0),
                leg.get('expiration') or '',
                float(leg.get('entry_price')) if leg.get('entry_price') is not None else None,
                float(leg.get('iv_override')) if leg.get('iv_override') is not None else None,
                i,
            ))

    @app.route('/api/options/strategies', methods=['POST'])
    def create_strategy():
        data = request.get_json(force=True) or {}
        name = (data.get('name') or '').strip()
        underlying = (data.get('underlying') or '').strip().upper()
        if not name or not underlying:
            return jsonify(error='name and underlying required'), 400
        conn = get_connection()
        try:
            cur = conn.execute("""
                INSERT INTO option_strategies (name, underlying, model, rate, notes)
                VALUES (?, ?, ?, ?, ?)
            """, (
                name, underlying,
                data.get('model') or 'black-scholes',
                float(data.get('rate') if data.get('rate') is not None else 0.0375),
                data.get('notes'),
            ))
            sid = cur.lastrowid
            _insert_legs(conn, sid, data.get('legs') or [])
            conn.commit()
            return jsonify(id=sid)
        finally:
            conn.close()

    @app.route('/api/options/strategies/<int:sid>', methods=['PUT'])
    def update_strategy(sid):
        data = request.get_json(force=True) or {}
        conn = get_connection()
        try:
            existing = conn.execute(
                "SELECT id FROM option_strategies WHERE id=?", (sid,)
            ).fetchone()
            if not existing:
                return jsonify(error='not found'), 404

            conn.execute("""
                UPDATE option_strategies
                SET name=COALESCE(?, name),
                    underlying=COALESCE(?, underlying),
                    model=COALESCE(?, model),
                    rate=COALESCE(?, rate),
                    notes=COALESCE(?, notes),
                    updated_date=CURRENT_TIMESTAMP
                WHERE id=?
            """, (
                data.get('name'),
                (data.get('underlying') or '').upper() or None,
                data.get('model'),
                data.get('rate'),
                data.get('notes'),
                sid,
            ))
            if 'legs' in data:
                conn.execute("DELETE FROM option_strategy_legs WHERE strategy_id=?", (sid,))
                _insert_legs(conn, sid, data['legs'] or [])
            conn.commit()
            return jsonify(ok=True)
        finally:
            conn.close()

    @app.route('/api/options/strategies/<int:sid>', methods=['DELETE'])
    def delete_strategy(sid):
        conn = get_connection()
        try:
            conn.execute("DELETE FROM option_strategy_legs WHERE strategy_id=?", (sid,))
            conn.execute("DELETE FROM option_strategies WHERE id=?", (sid,))
            conn.commit()
            return jsonify(ok=True)
        finally:
            conn.close()

"""Option pricing models: Black-Scholes (European) and Bjerksund-Stensland 2002 (American).

Conventions:
  S  = spot price
  K  = strike
  T  = time to expiration in years (ACT/365)
  r  = continuously compounded risk-free rate (e.g., 0.0375 for 3.75%)
  q  = continuously compounded dividend yield
  sigma = annualized volatility (e.g., 0.25 for 25%)
  opt_type = 'call' or 'put'

All functions return dicts with price and Greeks where applicable.
Greeks:
  delta     -> per $1 move in S
  gamma     -> per $1 move in S (d delta / dS)
  theta     -> per calendar day (already divided by 365)
  vega      -> per 1 vol point (already divided by 100)
  rho       -> per 1 rate point (already divided by 100)
"""

from __future__ import annotations

import math
from typing import Literal

OptType = Literal['call', 'put']

SQRT_2PI = math.sqrt(2.0 * math.pi)


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_2PI


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# ---------------------------------------------------------------------------
# Black-Scholes-Merton (European, with continuous dividend yield)
# ---------------------------------------------------------------------------

def black_scholes(
    S: float,
    K: float,
    T: float,
    r: float,
    q: float,
    sigma: float,
    opt_type: OptType,
) -> dict:
    if T <= 0 or sigma <= 0:
        intrinsic = max(S - K, 0.0) if opt_type == 'call' else max(K - S, 0.0)
        return {
            'price': intrinsic,
            'delta': 0.0 if T <= 0 else (1.0 if (opt_type == 'call' and S > K) else -1.0 if (opt_type == 'put' and S < K) else 0.0),
            'gamma': 0.0,
            'theta': 0.0,
            'vega': 0.0,
            'rho': 0.0,
        }

    sqrtT = math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT

    Nd1 = _norm_cdf(d1)
    Nd2 = _norm_cdf(d2)
    nd1 = _norm_pdf(d1)

    df_q = math.exp(-q * T)
    df_r = math.exp(-r * T)

    if opt_type == 'call':
        price = S * df_q * Nd1 - K * df_r * Nd2
        delta = df_q * Nd1
        theta_yr = (
            -(S * df_q * nd1 * sigma) / (2.0 * sqrtT)
            - r * K * df_r * Nd2
            + q * S * df_q * Nd1
        )
        rho = K * T * df_r * Nd2
    else:
        price = K * df_r * _norm_cdf(-d2) - S * df_q * _norm_cdf(-d1)
        delta = -df_q * _norm_cdf(-d1)
        theta_yr = (
            -(S * df_q * nd1 * sigma) / (2.0 * sqrtT)
            + r * K * df_r * _norm_cdf(-d2)
            - q * S * df_q * _norm_cdf(-d1)
        )
        rho = -K * T * df_r * _norm_cdf(-d2)

    gamma = (df_q * nd1) / (S * sigma * sqrtT)
    vega = S * df_q * nd1 * sqrtT

    return {
        'price': price,
        'delta': delta,
        'gamma': gamma,
        'theta': theta_yr / 365.0,
        'vega': vega / 100.0,
        'rho': rho / 100.0,
    }


# ---------------------------------------------------------------------------
# Bjerksund-Stensland 2002 (American option analytic approximation)
# ---------------------------------------------------------------------------
# Reference: Bjerksund & Stensland (2002), "Closed Form Valuation of American Options."
# We implement the American call directly; American put via the put-call
# transformation P(S,K,T,r,q,sigma) = C(K,S,T,q,r,sigma).

def _phi(S: float, T: float, gamma_: float, h: float, i: float,
         r: float, b: float, sigma: float) -> float:
    sigma2 = sigma * sigma
    lam = (-r + gamma_ * b + 0.5 * gamma_ * (gamma_ - 1.0) * sigma2) * T
    kappa = 2.0 * b / sigma2 + (2.0 * gamma_ - 1.0)
    sqrtT = math.sqrt(T)
    d = -(math.log(S / h) + (b + (gamma_ - 0.5) * sigma2) * T) / (sigma * sqrtT)
    return (
        math.exp(lam)
        * (S ** gamma_)
        * (_norm_cdf(d) - ((i / S) ** kappa) * _norm_cdf(d - 2.0 * math.log(i / S) / (sigma * sqrtT)))
    )


def _psi(S: float, T2: float, gamma_: float, h: float, i2: float, i1: float,
         t1: float, r: float, b: float, sigma: float) -> float:
    sigma2 = sigma * sigma
    sqrtT2 = math.sqrt(T2)
    sqrt_t1 = math.sqrt(t1)
    e1 = (math.log(S / i1) + (b + (gamma_ - 0.5) * sigma2) * t1) / (sigma * sqrt_t1)
    e2 = (math.log(i2 * i2 / (S * i1)) + (b + (gamma_ - 0.5) * sigma2) * t1) / (sigma * sqrt_t1)
    e3 = (math.log(S / i1) - (b + (gamma_ - 0.5) * sigma2) * t1) / (sigma * sqrt_t1)
    e4 = (math.log(i2 * i2 / (S * i1)) - (b + (gamma_ - 0.5) * sigma2) * t1) / (sigma * sqrt_t1)

    f1 = (math.log(S / h) + (b + (gamma_ - 0.5) * sigma2) * T2) / (sigma * sqrtT2)
    f2 = (math.log(i2 * i2 / (S * h)) + (b + (gamma_ - 0.5) * sigma2) * T2) / (sigma * sqrtT2)
    f3 = (math.log(i1 * i1 / (S * h)) + (b + (gamma_ - 0.5) * sigma2) * T2) / (sigma * sqrtT2)
    f4 = (math.log(S * i1 * i1 / (h * i2 * i2)) + (b + (gamma_ - 0.5) * sigma2) * T2) / (sigma * sqrtT2)

    rho_ = math.sqrt(t1 / T2)
    lam = -r + gamma_ * b + 0.5 * gamma_ * (gamma_ - 1.0) * sigma2
    kappa = 2.0 * b / sigma2 + (2.0 * gamma_ - 1.0)

    return (
        math.exp(lam * T2)
        * (S ** gamma_)
        * (
            _bivar_norm_cdf(-e1, -f1, rho_)
            - ((i2 / S) ** kappa) * _bivar_norm_cdf(-e2, -f2, rho_)
            - ((i1 / S) ** kappa) * _bivar_norm_cdf(-e3, -f3, -rho_)
            + ((i1 / i2) ** kappa) * _bivar_norm_cdf(-e4, -f4, -rho_)
        )
    )


def _bivar_norm_cdf(a: float, b: float, rho: float) -> float:
    """Drezner-Wesolowsky bivariate normal CDF (1990). Accurate to ~1e-6."""
    if abs(rho) < 1e-12:
        return _norm_cdf(a) * _norm_cdf(b)

    # Gauss-Legendre 5-point for [-1, 1] scaled to [0, rho]
    x = [-0.9061798459, -0.5384693101, 0.0, 0.5384693101, 0.9061798459]
    w = [0.2369268851, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268851]

    def f(r_: float) -> float:
        denom = math.sqrt(1.0 - r_ * r_)
        return math.exp(-(a * a - 2.0 * r_ * a * b + b * b) / (2.0 * (1.0 - r_ * r_))) / denom

    # Integrate f from 0 to rho, divide by 2*pi, add Na*Nb
    half = 0.5 * rho
    total = 0.0
    for xi, wi in zip(x, w):
        r_ = half * xi + half
        total += wi * f(r_)
    integral = half * total
    return _norm_cdf(a) * _norm_cdf(b) + integral / (2.0 * math.pi)


def _bjerksund_stensland_call(S: float, K: float, T: float, r: float, b: float, sigma: float) -> float:
    """American call on an asset paying continuous cost-of-carry b (b = r - q)."""
    if b >= r:
        # Never optimal to exercise early -> European price (with cost of carry)
        # Using BS with q = r - b.
        q = r - b
        return black_scholes(S, K, T, r, q, sigma, 'call')['price']

    sigma2 = sigma * sigma
    t1 = 0.5 * (math.sqrt(5.0) - 1.0) * T

    beta = (0.5 - b / sigma2) + math.sqrt((b / sigma2 - 0.5) ** 2 + 2.0 * r / sigma2)
    b_inf = beta / (beta - 1.0) * K
    b0 = max(K, r / (r - b) * K)

    h1 = -(b * t1 + 2.0 * sigma * math.sqrt(t1)) * (K * K) / ((b_inf - b0) * b0)
    h2 = -(b * T + 2.0 * sigma * math.sqrt(T)) * (K * K) / ((b_inf - b0) * b0)

    i1 = b0 + (b_inf - b0) * (1.0 - math.exp(h1))
    i2 = b0 + (b_inf - b0) * (1.0 - math.exp(h2))

    alpha1 = (i1 - K) * (i1 ** (-beta))
    alpha2 = (i2 - K) * (i2 ** (-beta))

    if S >= i2:
        return S - K

    return (
        alpha2 * (S ** beta)
        - alpha2 * _phi(S, t1, beta, i2, i2, r, b, sigma)
        + _phi(S, t1, 1.0, i2, i2, r, b, sigma)
        - _phi(S, t1, 1.0, i1, i2, r, b, sigma)
        - K * _phi(S, t1, 0.0, i2, i2, r, b, sigma)
        + K * _phi(S, t1, 0.0, i1, i2, r, b, sigma)
        + alpha1 * _phi(S, t1, beta, i1, i2, r, b, sigma)
        - alpha1 * _psi(S, T, beta, i1, i2, i1, t1, r, b, sigma)
        + _psi(S, T, 1.0, i1, i2, i1, t1, r, b, sigma)
        - _psi(S, T, 1.0, K, i2, i1, t1, r, b, sigma)
        - K * _psi(S, T, 0.0, i1, i2, i1, t1, r, b, sigma)
        + K * _psi(S, T, 0.0, K, i2, i1, t1, r, b, sigma)
    )


def bjerksund_stensland(
    S: float,
    K: float,
    T: float,
    r: float,
    q: float,
    sigma: float,
    opt_type: OptType,
) -> dict:
    """American option price + Greeks via finite differences on the B-S 2002 formula."""
    if T <= 0 or sigma <= 0:
        intrinsic = max(S - K, 0.0) if opt_type == 'call' else max(K - S, 0.0)
        return {'price': intrinsic, 'delta': 0.0, 'gamma': 0.0,
                'theta': 0.0, 'vega': 0.0, 'rho': 0.0}

    def px(S_, K_, T_, r_, q_, sigma_, typ):
        b = r_ - q_
        if typ == 'call':
            return _bjerksund_stensland_call(S_, K_, T_, r_, b, sigma_)
        # American put via transformation: P(S,K,T,r,q,sigma) = C(K,S,T,q,r,sigma)
        return _bjerksund_stensland_call(K_, S_, T_, q_, q_ - r_, sigma_)

    price = px(S, K, T, r, q, sigma, opt_type)

    # Finite-difference Greeks
    hS = max(S * 1e-4, 1e-4)
    p_up = px(S + hS, K, T, r, q, sigma, opt_type)
    p_dn = px(S - hS, K, T, r, q, sigma, opt_type)
    delta = (p_up - p_dn) / (2.0 * hS)
    gamma = (p_up - 2.0 * price + p_dn) / (hS * hS)

    hSig = 1e-4
    p_vega_up = px(S, K, T, r, q, sigma + hSig, opt_type)
    vega = (p_vega_up - price) / hSig / 100.0

    hT = min(1.0 / 365.0, T * 0.5)
    p_theta = px(S, K, max(T - hT, 1e-8), r, q, sigma, opt_type)
    theta = (p_theta - price) / hT / 365.0

    hR = 1e-4
    p_rho = px(S, K, T, r + hR, q, sigma, opt_type)
    rho = (p_rho - price) / hR / 100.0

    return {
        'price': price,
        'delta': delta,
        'gamma': gamma,
        'theta': theta,
        'vega': vega,
        'rho': rho,
    }


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------

def price_option(
    S: float,
    K: float,
    T: float,
    r: float,
    q: float,
    sigma: float,
    opt_type: OptType,
    model: Literal['black-scholes', 'bjerksund-stensland'] = 'black-scholes',
) -> dict:
    if model == 'black-scholes':
        return black_scholes(S, K, T, r, q, sigma, opt_type)
    if model == 'bjerksund-stensland':
        return bjerksund_stensland(S, K, T, r, q, sigma, opt_type)
    raise ValueError(f'Unknown model: {model}')


# ---------------------------------------------------------------------------
# Implied volatility (Newton-Raphson with bisection fallback)
# ---------------------------------------------------------------------------

def implied_vol(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    q: float,
    opt_type: OptType,
    model: Literal['black-scholes', 'bjerksund-stensland'] = 'black-scholes',
    tol: float = 1e-6,
    max_iter: int = 100,
) -> float | None:
    if market_price <= 0 or T <= 0:
        return None

    intrinsic = max(S - K, 0.0) if opt_type == 'call' else max(K - S, 0.0)
    if market_price < intrinsic - 1e-8:
        return None

    lo, hi = 1e-5, 5.0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        p = price_option(S, K, T, r, q, mid, opt_type, model)['price']
        if abs(p - market_price) < tol:
            return mid
        if p < market_price:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)

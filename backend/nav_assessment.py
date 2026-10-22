"""NAV accounting for the dashboard. Descriptive measurements, never a causal risk score.

Inputs must be official per-original-share NAV and distribution entitlements on
matching valuation dates, with corporate actions already resolved. A price proxy
can be described but cannot establish NAV preservation or erosion causation.
"""
from dataclasses import dataclass
from math import isfinite, prod


@dataclass(frozen=True)
class CapitalObservation:
    start: float
    end: float
    distributions: float
    basis: str = "published_nav"
    data_complete: bool = True
    corporate_actions_resolved: bool = True
    liquidated: bool = False

    def measure(self, tolerance=0.01):
        values = (self.start, self.end, self.distributions)
        if not all(isfinite(x) for x in values):
            raise ValueError("Nonfinite accounting input")
        if self.start <= 0 or self.end < 0 or self.distributions < 0:
            raise ValueError("Invalid accounting input")
        if self.liquidated and self.end != 0:
            raise ValueError("A final liquidation observation must have zero remaining NAV")
        if not isfinite(tolerance) or tolerance < 0:
            raise ValueError("Invalid source precision")
        supported = (
            self.basis == "published_nav"
            and self.data_complete
            and self.corporate_actions_resolved
        )
        gain = self.end - self.start + self.distributions
        return {
            "nav_observation_supported": supported,
            "capital_change": self.end - self.start,
            "capital_change_rate": self.end / self.start - 1,
            "investment_result": gain,
            "cash_total_return": gain / self.start,
            "distribution_rate_on_start": self.distributions / self.start,
            "result_to_payout_ratio": gain / self.distributions if self.distributions else None,
            # This is an accounting observation, NOT causal attribution or tax ROC.
            "payouts_not_replenished": (
                self.end < self.start - tolerance
                if supported and self.distributions > 0 and not self.liquidated else None
            ),
            "capital_status": (
                "unconfirmed" if not supported else
                "liquidated" if self.liquidated else
                "declined" if self.end < self.start - tolerance else
                "preserved" if self.end > self.start + tolerance else "within_precision"
            ),
        }


def same_cash_reference(start, total_returns, withdrawals):
    """Self-financing reference paying the SAME dated cash amounts as the fund.

    total_returns are decimal, net-of-specified-reference-cost returns; cash is
    removed after that period's return, consistent with its ex-distribution NAV.
    The caller must align both sequences to exactly the same valuation dates.
    Stop when the hypothetical account cannot finance its promised withdrawal.
    """
    if len(total_returns) != len(withdrawals):
        raise ValueError("Reference and cash-flow dates must match")
    if not isfinite(start) or start <= 0:
        raise ValueError("Invalid starting reference value")
    value = start
    for period, (ret, cash) in enumerate(zip(total_returns, withdrawals), 1):
        if not all(isfinite(x) for x in (ret, cash)) or ret < -1 or cash < 0:
            raise ValueError("Invalid return or withdrawal")
        before_withdrawal = value * (1 + ret)
        if cash > before_withdrawal:
            return {"status": "exhausted", "ending_value": None, "period": period}
        value = before_withdrawal - cash
    return {"status": "available", "ending_value": value, "period": len(withdrawals)}


def reinvested_return(nav, distributions):
    """Standardized return is separate from taking the distributions as cash."""
    if len(nav) != len(distributions) + 1:
        raise ValueError("One distribution entitlement per return interval required")
    if any(not isfinite(n) or n <= 0 for n in nav):
        raise ValueError("NAV values must be finite and positive")
    if any(not isfinite(d) or d < 0 for d in distributions):
        raise ValueError("Invalid distributions")
    return prod((nav[i + 1] + d) / nav[i] for i, d in enumerate(distributions)) - 1


def daily_exposure_reference(legs, weights, costs=None):
    """Construct a daily target reference, not a multiple of full-period return.

    Weights are declared exposures per unit NAV; they need not add to one for
    stacked/leveraged funds. The implementation must supply disclosed funding
    costs and rebalance timing; an unknown cost cannot support causal attribution.
    """
    if not legs or len(legs) != len(weights):
        raise ValueError("One weight per reference leg required")
    n = len(legs[0])
    if any(len(leg) != n for leg in legs):
        raise ValueError("Reference leg dates must match")
    costs = [0.0] * n if costs is None else costs
    if len(costs) != n:
        raise ValueError("Reference cost dates must match")
    if not all(isfinite(w) for w in weights):
        raise ValueError("Invalid exposure weight")
    out = []
    for i in range(n):
        if not isfinite(costs[i]) or costs[i] < 0:
            raise ValueError("Invalid cost")
        if any(not isfinite(leg[i]) or leg[i] < -1 for leg in legs):
            raise ValueError("Invalid leg return")
        result = sum(w * leg[i] for w, leg in zip(weights, legs)) - costs[i]
        if result < -1:
            raise ValueError("Reference is exhausted; do not compound a negative account")
        out.append(result)
    return out


def assess(observation, reference=None, *, reference_quality="missing", tolerance=0.01):
    """Descriptive assessments only; no forecast risk score or causal verdict.

    tolerance is a per-original-share bound from source rounding/measurement
    precision. It is NOT a fitted or arbitrary economic risk threshold.
    """
    if tolerance < 0 or not isfinite(tolerance):
        raise ValueError("Invalid measurement tolerance")
    result = observation.measure(tolerance)
    result["structural_erosion"] = "unconfirmed"
    result["reference_status"] = "unavailable"
    result["ending_capital_gap"] = None
    if not result["nav_observation_supported"]:
        result["review"] = "NAV or accounting evidence required"
        return result
    if reference and reference["status"] == "available":
        gap = observation.end - reference["ending_value"]
        result["ending_capital_gap"] = gap
        result["reference_status"] = (
            "below" if gap < -tolerance else "above" if gap > tolerance else "within_precision"
        )
    if result["capital_status"] == "liquidated":
        result["review"] = "Fund liquidated; assess final proceeds and total economic result"
    elif result["capital_status"] == "within_precision":
        result["review"] = "Capital change is within source precision"
    elif result["capital_status"] == "preserved":
        result["review"] = "Capital preserved; any reference shortfall is a performance issue"
    elif observation.distributions == 0:
        result["review"] = "Capital declined; there were no distributions in this period"
    elif result["investment_result"] >= 0 and observation.distributions > 0:
        result["review"] = "Positive investment result did not replenish cash paid out"
    else:
        result["review"] = "Capital declined during investment losses; cause unconfirmed"
    if result["reference_status"] == "below":
        result["review"] += (
            "; comparable-strategy review warranted"
            if reference_quality == "strategy_matched"
            else "; reference gap is not proof of destructive erosion"
        )
    return result

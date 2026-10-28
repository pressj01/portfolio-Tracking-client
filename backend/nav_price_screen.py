"""Preliminary fund screening from traded prices, kept separate from fund NAV.

Inputs are split-restated closes and distributions on the same share basis.
They must never be relabeled as published NAV, including for BDCs and CEFs.
"""
import bisect
import datetime as dt
import calendar

# Explicit review-policy thresholds, not fitted probabilities or a claim that
# smaller losses cannot matter. Completed payout cycles limit ex-date noise.
INTERVAL_DECLINE = .0025
INTERVAL_GAP = .0025
WINDOW_DECLINE = .01
WINDOW_GAP = .005
# NAV lag: a call-selling fund's price trailing its underlying's price by at
# least one percentage point over the window. It is a description, never
# erosion, and is reported only when the erosion tests found nothing.
LAG_MIN = .01
NAV_LAG_LABEL = 'NAV lag — not erosion'
# TR/Und is a ratio only when the underlying rose at least this much. At 1%,
# FSCO -11.5% against HYG +1.3% still read as -918%.
UNDERLYING_RATIO_FLOOR = .02

try:
    from .nav_assessment_service import date, number, compare_reference
except ImportError:
    from nav_assessment_service import date, number, compare_reference


def interval_check(prices, paid, first, last, plan, loader):
    """Independent complete calendar months within the selected window.

    Persistence is a stated review policy, not a probability: two consecutive
    qualifying blocks, or at least two and two-thirds of supportive blocks.
    """
    boundaries = []
    for year in range(first.year,last.year+1):
        for month in range(1,13):
            end = dt.date(year,month,calendar.monthrange(year,month)[1])
            begin = dt.date(year-1,12,31) if month == 1 else dt.date(year,month-1,calendar.monthrange(year,month-1)[1])
            if begin >= first and end <= last:
                boundaries.append((begin,end))
    days = sorted(prices)
    windows = []
    for begin,end in boundaries:
        starts, ends = [d for d in days if d <= begin], [d for d in days if d <= end]
        if not starts or not ends:
            continue
        a,b = starts[-1],ends[-1]
        if a < first or a >= b or (begin-a).days > 4 or (end-b).days > 4:
            continue
        cash = {day:value for day,value in paid.items() if a < day <= b}
        try:
            ref = compare_reference(prices[a],prices[b],a,b,cash,plan,loader)
        except Exception:
            ref = {'status':'unavailable'}
        supportive = ref.get('status') == 'available' and ref['before_payout_return'] >= -.0025
        decline = prices[a]-prices[b] >= max(.01, prices[a]*INTERVAL_DECLINE)
        relative_shortfall = ref.get('status') == 'available' and ref.get('capital_gap_rate',0) <= -INTERVAL_GAP
        payout_rate = sum(cash.values())/prices[a]
        cash_return = (prices[b]-prices[a]+sum(cash.values()))/prices[a]
        windows.append({'start':a.isoformat(),'end':b.isoformat(),
                        'price_change_rate':prices[b]/prices[a]-1,
                        'cash_total_return':cash_return,'distribution_rate':payout_rate,
                        'payouts_exceed_fund_return':sum(cash.values()) > 0 and prices[b] < prices[a]-.01,
                        'payouts_exceed_reference_return':payout_rate > ref['before_payout_return'] if ref.get('status') == 'available' else None,
                        'reference_return':ref.get('before_payout_return'),
                        'reference_gap_rate':ref.get('capital_gap_rate'),
                        'reference_status':ref.get('status'), 'supportive':supportive,
                        'material_relative_shortfall':bool(relative_shortfall),
                        'qualifies':bool(supportive and decline and relative_shortfall)})
    supportive_count = sum(w['supportive'] for w in windows)
    qualifying = sum(w['qualifies'] for w in windows)
    joint = sum(w['qualifies'] and w['payouts_exceed_reference_return'] is True for w in windows)
    run = joint_run = longest = longest_joint = 0
    for w in windows:
        run = run+1 if w['qualifies'] else 0
        joint_run = joint_run+1 if w['qualifies'] and w['payouts_exceed_reference_return'] is True else 0
        longest, longest_joint = max(longest,run),max(longest_joint,joint_run)
    repeated = longest >= 2 or (qualifying >= 2 and qualifying/supportive_count >= 2/3)
    both_repeated = longest_joint >= 2 or (joint >= 2 and joint/supportive_count >= 2/3)
    return {'cadence':'month', 'windows':windows,
            'intervals_compared':sum(w['reference_status'] == 'available' for w in windows),
            'supportive_intervals':supportive_count,'qualifying_intervals':qualifying,
            'payout_shortfall_intervals':sum(w['payouts_exceed_fund_return'] for w in windows),
            'payout_above_reference_intervals':sum(w['supportive'] and w['payouts_exceed_reference_return'] is True for w in windows),
            'minimum_required':2,'repeated':repeated,'flat_tolerance':.0025,
            'interval_decline_floor':INTERVAL_DECLINE, 'interval_gap_floor':INTERVAL_GAP,
            'joint_qualifying_intervals':joint, 'both_repeated':both_repeated,
            'consecutive_qualifying_intervals':longest,'consecutive_joint_intervals':longest_joint,
            'status':'repeated_declines' if repeated else 'not_established' if supportive_count >= 2 else 'insufficient_evidence'}


def reference_price_index(plan, first, last, loader):
    """The reference's closing-price path, 1.0 on `first`.

    Prices only, no dividends: this is what the underlying's price did. Legs
    are combined with the plan's daily exposure weights, so a single 100% leg
    is just its own price ratio. None when a leg lacks either end date.
    """
    if not plan.get('legs') or plan.get('warning'):
        return None
    histories = []
    for leg in plan['legs']:
        raw = loader(leg['symbol'], first, last) or {}
        clean = {}
        for day, value in raw.items():
            day, value = date(day), number(value)
            if first <= day <= last and value is not None and value > 0:
                clean[day] = value
        if first not in clean or last not in clean:
            return None
        histories.append(clean)
    days = sorted(set.intersection(*(set(history) for history in histories)))
    index, level = {first: 1.0}, 1.0
    for previous, day in zip(days, days[1:]):
        level *= 1 + sum(leg['weight'] * (history[day]/history[previous]-1)
                         for leg, history in zip(plan['legs'], histories))
        if level <= 0:
            return None
        index[day] = level
    return index


def nav_lag(plan, strategy, ref, persistence, p0, pt, first, last, cash, price_loader, *, erosion):
    """Whether a call-selling fund's price trailed its underlying's price.

    Selling calls caps the upside and the premium is paid out, so the price of
    a covered-call fund usually trails its underlying. That is NAV lag, not
    NAV erosion. It is reported only when the erosion test had enough months
    to run and found nothing; erosion, when found, is reported instead.
    """
    name = plan.get('selected') or 'the reference'
    out = {'status':'not_applicable', 'threshold':LAG_MIN, 'reference':name}
    if strategy.get('kind') != 'covered_call':
        return out
    if erosion:
        return {**out, 'status':'superseded'}
    if ref.get('status') != 'available' or persistence['supportive_intervals'] < 2:
        return {**out, 'status':'insufficient_evidence'}
    try:
        index = reference_price_index(plan, first, last, price_loader)
    except Exception:
        index = None
    if not index or last not in index:
        return {**out, 'status':'unavailable'}
    underlying, fund = index[last]-1, pt/p0-1
    lag, payout, gap = underlying-fund, cash/p0, ref['capital_gap_rate']
    out.update(underlying_price_change_rate=underlying, fund_price_change_rate=fund, lag_rate=lag,
               payout_rate=payout, same_cash_gap_rate=gap,
               status='lag' if lag >= LAG_MIN else 'none')
    if out['status'] != 'lag':
        return out
    def pct(value):
        return f'{abs(value) * 100:.1f}%'
    def moved(value):
        return f'rose {pct(value)}' if value >= 0 else f'fell {pct(value)}'
    text = (f'The fund’s price {moved(fund)} while {name}’s price {moved(underlying)}, so it trailed by '
            f'{lag * 100:.1f} points. A covered-call fund is expected to trail its underlying: it pays its option income '
            f'out as cash ({pct(payout)} of its starting price here) and gives up part of {name}’s gains when it rises. ')
    if gap <= -WINDOW_GAP:
        text += f'Counting that cash, it still kept {pct(gap)} less capital than {name} would have. '
    elif gap >= WINDOW_GAP:
        text += f'Counting that cash, it kept more capital than {name} would have. '
    else:
        text += f'Counting that cash, it kept pace with {name}. '
    text += ('This is not NAV erosion: the price did not repeatedly fall in months when '
             f'{name} was flat or up.' if not persistence['repeated'] else
             f'This is not NAV erosion: although the price fell in several months when {name} was flat or up, over '
             f'the whole period it did not both lose at least {WINDOW_DECLINE * 100:.0f}% and end at least '
             f'{WINDOW_GAP * 100:.1f}% behind {name} after paying the same cash.')
    out['reason'] = text
    return out


def _plain_reason(plan, strategy, ref, persistence, price_change, *, candidate, eligible, eroder, lagged_only):
    """What the check found, in plain words and the fund's own numbers."""
    name = plan.get('selected') or 'the reference'
    gap = ref.get('capital_gap_rate') if ref.get('status') == 'available' else None
    def pct(value):
        return f'{abs(value) * 100:.1f}%'
    flat, fell = persistence['supportive_intervals'], persistence['qualifying_intervals']
    behind = (f'After paying out the same cash, the fund ended with {pct(gap)} less capital than {name}'
              if gap is not None and gap < 0 else None)
    if candidate:
        text = (f'Over these dates the price fell {pct(price_change)}. {behind}. In {fell} of the {flat} months when '
                f'{name} was flat or up, the fund’s price still fell.')
        if eroder:
            text += (f' Its payouts were also bigger than {name}’s return in those months: the pattern of a call-income '
                     'fund paying out more than it earns.')
        elif eligible:
            text += (f' It sells call options, but its payouts did not repeatedly exceed {name}’s return, so it is not '
                     'labelled a covered-call eroder.')
        elif strategy.get('payout_driven_only'):
            text += (f' Its payouts were also bigger than {name}’s return in those months, so the cash it pays out is '
                     'not being earned back.')
        elif strategy['kind'] == 'needs_verification':
            text += ' Whether it sells call options is not known, so it cannot be labelled a covered-call eroder.'
        else:
            text += ' It does not sell call options, so this flags lost capital only, not covered-call erosion.'
        return text + ' Based on market prices, not published NAV.'
    if lagged_only:
        return (f'{behind or f"The price fell behind {name}"}, and the price fell in months when {name} was flat or up. '
                f'But its payouts did not repeatedly exceed {name}’s return, so this is weaker performance, not '
                'payout-driven NAV erosion.')
    if gap is not None and gap >= 0:
        return (f'After paying out the same cash, the fund kept at least as much capital as {name}. '
                'A high payout alone is not erosion.')
    if flat < 2:
        return (f'Fewer than two completed months with {name} flat or up in these dates, so a repeated pattern cannot '
                'be checked yet.')
    lead = f'{behind}, but its' if behind else 'Its'
    return (f'{lead} price did not keep falling in the months when {name} was flat or up, so there is no repeated '
            'pattern of lost capital.')


def screen(source, start, end, plan, reference_loader, price_loader=None, *, verified_erosion=False):
    """Price-based erosion screen for one fund, with NAV lag for call sellers.

    reference_loader gives total-return closes; price_loader gives plain
    closes for the NAV-lag comparison (total returns are used when it is
    missing). verified_erosion is the published-NAV check's own flag: it
    outranks NAV lag, so a fund is never shown as both.
    """
    if not source or source.get('basis') != 'split_adjusted_market_price':
        return {'status': 'unavailable', 'reason': 'Split-adjusted price and payout history is unavailable.'}
    if not source.get('distributions_complete') or not source.get('corporate_actions_resolved'):
        return {'status': 'unavailable', 'reason': 'Price/payout history or split adjustments are incomplete.'}
    prices = {}
    for row in source.get('prices', []):
        day, value = date(row['date']), number(row.get('close'))
        if day > end:
            continue
        if value is None or value <= 0 or day in prices:
            raise ValueError('Invalid or duplicate market-price observations')
        prices[day] = value
    days = sorted(prices)
    if len(days) < 2:
        return {'status': 'unavailable', 'reason': 'At least two valid closing prices are required.'}
    before = [day for day in days if day <= start]
    first, last = (before[-1] if before else days[0]), days[-1]
    if first >= last or (before and (start-first).days > 7) or (end-last).days > 7:
        return {'status': 'unavailable', 'reason': 'No fresh price interval matches the selected range.'}
    reference_histories = {}
    def aligned_loader(symbol,a,b):
        if symbol not in reference_histories:
            reference_histories[symbol] = reference_loader(symbol,first,last)
        return {day:value for day,value in (reference_histories[symbol] or {}).items() if a <= date(day) <= b}
    original_last = last
    # A reference can publish today's closing bar later than the ETF. Compare
    # both on their most recent common valid close, without inventing a return.
    if plan.get('legs') and not plan.get('requires_aligned_crypto_close'):
        try:
            common = set(prices)
            for leg in plan['legs']:
                raw = aligned_loader(leg['symbol'],first,last)
                common &= {date(day) for day,value in raw.items() if number(value) is not None and number(value) > 0}
            common = sorted(day for day in common if first <= day <= last)
            if common and first < common[-1] < last and (last-common[-1]).days <= 4:
                last = common[-1]
        except Exception:
            pass
    days = [day for day in days if first <= day <= last]
    if any((b-a).days > 7 for a,b in zip(days,days[1:])):
        return {'status': 'unavailable', 'reason': 'Market-price history has an unexplained gap.'}
    paid = {}
    for row in source.get('distributions', []):
        day, amount = date(row['date']), number(row.get('amount'))
        if not first < day <= last:
            continue
        if amount is None or amount < 0 or day in paid:
            raise ValueError('Incomplete or duplicate market-data distributions')
        paid[day] = amount
    p0, pt, distributions = prices[first], prices[last], sum(paid.values())
    change, gain = pt-p0, pt-p0+distributions
    ref = compare_reference(p0,pt,first,last,paid,plan,aligned_loader)
    persistence = interval_check(prices,paid,first,last,plan,aligned_loader)
    # A high payout is insufficient if the reference paid the same cash and
    # retained less capital. A small distribution-cycle wiggle is insufficient.
    material_decline = -change >= max(.01,p0*WINDOW_DECLINE)
    relative_shortfall = ref.get('status') == 'available' and ref.get('capital_gap_rate',0) <= -WINDOW_GAP
    candidate = material_decline and relative_shortfall and persistence['repeated'] and not plan['warning']
    strategy = plan.get('screen_strategy', {'kind':'needs_verification', 'label':'Strategy not verified'})
    # An inferred plain fund (index, bond, sector) that only lagged its
    # reference is relative performance; erosion needs the payouts too.
    lagged_only = bool(candidate and strategy.get('payout_driven_only') and not persistence['both_repeated'])
    candidate = candidate and not lagged_only
    eligible = strategy['kind'] == 'covered_call'
    eroder = candidate and persistence['both_repeated'] and eligible
    price_history = {}
    def aligned_prices(symbol,a,b):
        if symbol not in price_history:
            price_history[symbol] = (price_loader or reference_loader)(symbol,first,last)
        return {day:value for day,value in (price_history[symbol] or {}).items() if a <= date(day) <= b}
    lag = nav_lag(plan, strategy, ref, persistence, p0, pt, first, last, distributions, aligned_prices,
                  erosion=bool(candidate or verified_erosion))
    label = ('Estimated covered-call eroder' if eroder else
             'Losing capital vs reference' if candidate else
             NAV_LAG_LABEL if lag['status'] == 'lag' else
             'No covered-call erosion signal' if eligible and persistence['supportive_intervals'] >= 2 else
             'Covered-call screen: limited evidence' if eligible else
             'Strategy needs verification' if strategy['kind'] == 'needs_verification' else
             'Lagged reference — no payout erosion' if lagged_only else
             # Other strategies get no eroder label, but the capital test
             # still ran; say whether it found anything.
             'No capital / payout signal' if ref.get('status') == 'available' and persistence['supportive_intervals'] >= 2 else
             'Capital / payout: limited evidence')
    reason = lag['reason'] if lag['status'] == 'lag' else _plain_reason(
        plan, strategy, ref, persistence, change / p0,
        candidate=candidate, eligible=eligible, eroder=eroder, lagged_only=lagged_only)
    return {'status':'available', 'basis':'market_price', 'published_nav':False,
            'start':first.isoformat(), 'end':last.isoformat(),
            'shorter_history':start.year != 1900 and first > start,
            'reference_aligned_end':last < original_last,
            'source':{key:source.get(key) for key in ('label','url','provider','fetched_at')},
            'price_change_rate':change/p0, 'cash_paid':distributions,
            'cash_total_return':gain/p0, 'distribution_rate_on_start':distributions/p0,
            'investment_result':gain, 'start_price':p0, 'end_price':pt,
            'reference_result':ref, 'persistence':persistence, 'review_candidate':bool(candidate),
            'strategy':strategy, 'covered_call_eligible':eligible,
            'window_decline_floor':WINDOW_DECLINE, 'window_gap_floor':WINDOW_GAP,
            'estimated_eroder':bool(eroder), 'nav_lag':lag, 'label':label, 'reason':reason,
            'limitation':'Preliminary price-based estimate. Premiums/discounts, exposure differences and payout timing can affect it; this is not verified NAV erosion.'}


def underlying_comparison(source, start, end, plan, loader):
    """TR/Und: the fund's total return over its underlying's, on the same dates.

    Both sides reinvest: the fund's distributions are reinvested at that day's
    close, as the underlying's total-return closes already are, so a high
    payer is not measured on cash while its underlying compounds. `plan` is
    the underlying from underlying_plan (via underlying_pending), never the
    NAV screen's benchmark. A ratio against an underlying that fell or barely
    moved flips sign or explodes (ARCC +0.5% against BIZD -6.3% read as -9%),
    so below UNDERLYING_RATIO_FLOOR only the gap in points is given.
    """
    out = {key: plan.get(key) for key in ('selected', 'legs', 'source', 'fit', 'why')}
    out['status'] = 'unavailable'
    if any(leg['symbol'].endswith('-USD') for leg in plan['legs']):
        return {**out, 'reason': 'Crypto trades around the clock; its midnight close is not matched to a US fund close.'}
    if not source or source.get('basis') != 'split_adjusted_market_price':
        return {**out, 'reason': 'Split-adjusted price and payout history is unavailable.'}
    if not source.get('distributions_complete') or not source.get('corporate_actions_resolved'):
        return {**out, 'reason': 'Price/payout history or split adjustments are incomplete.'}
    prices = {}
    for row in source.get('prices', []):
        day, value = date(row['date']), number(row.get('close'))
        if day <= end and value is not None and value > 0:
            prices[day] = value
    if len(prices) < 2:
        return {**out, 'reason': 'At least two valid closing prices are required.'}
    lo, hi = min(prices), max(prices)
    histories = []
    for leg in plan['legs']:
        raw = loader(leg['symbol'], lo, hi) or {}
        histories.append({date(day): number(value) for day, value in raw.items()
                          if number(value) is not None and number(value) > 0})
    days = sorted(set(prices).intersection(*(set(history) for history in histories)))
    before = [day for day in days if day <= start]
    days = [day for day in days if day >= (before[-1] if before else start)]
    if len(days) < 2 or (before and (start-days[0]).days > 7) or (end-days[-1]).days > 7:
        return {**out, 'reason': f'{plan["selected"]} and the fund have no shared closes matching the selected range.'}
    if any((b-a).days > 7 for a, b in zip(days, days[1:])):
        return {**out, 'reason': 'Price history has an unexplained gap.'}
    first, last = days[0], days[-1]
    # A distribution counts on the first shared close on or after its ex-date.
    paid = {}
    for row in source.get('distributions', []):
        day, amount = date(row['date']), number(row.get('amount')) or 0
        if first < day <= last:
            landing = days[bisect.bisect_left(days, day)]
            paid[landing] = paid.get(landing, 0) + amount
    fund = underlying = 1.0
    for previous, day in zip(days, days[1:]):
        fund *= (prices[day] + paid.get(day, 0)) / prices[previous]
        underlying *= 1 + sum(leg['weight'] * (history[day]/history[previous]-1)
                              for leg, history in zip(plan['legs'], histories))
    fund_return, underlying_return = fund-1, underlying-1
    return {**out, 'status': 'available', 'basis': 'market_price', 'start': first.isoformat(), 'end': last.isoformat(),
            'shorter_history': start.year != 1900 and first > start,
            'fund_return': fund_return, 'underlying_return': underlying_return,
            'gap': fund_return-underlying_return, 'ratio_floor': UNDERLYING_RATIO_FLOOR,
            'ratio': fund_return/underlying_return if underlying_return >= UNDERLYING_RATIO_FLOOR else None}


def summarize(results):
    applicable = [row for row in results if row['capital_status'] != 'not_applicable']
    covered = [row for row in applicable if row.get('price_screen',{}).get('status') == 'available']
    candidates = [row for row in covered if row['price_screen']['review_candidate']]
    eroders = [row for row in candidates if row['price_screen']['estimated_eroder']]
    values_complete = all(row.get('current_value') is not None for row in applicable)
    total = sum(row.get('current_value') or 0 for row in applicable)
    covered_value = sum(row.get('current_value') or 0 for row in covered)
    def weighted(field):
        if not values_complete or covered_value <= 0:
            return None
        return sum(row['current_value']*row['price_screen'][field] for row in covered)/covered_value
    return {'covered_count':len(covered), 'applicable_count':len(applicable),
            'covered_value':covered_value, 'applicable_value':total,
            'value_coverage':covered_value/total if total > 0 and values_complete else None,
            'missing_tickers':[row['ticker'] for row in applicable if row not in covered],
            'reference_covered_count':sum(row['price_screen']['reference_result']['status'] == 'available' for row in covered),
            'reference_unavailable_tickers':[row['ticker'] for row in covered if row['price_screen']['reference_result']['status'] != 'available'],
            'persistence_evaluable_count':sum(row['price_screen']['persistence']['supportive_intervals'] >= 2 for row in covered),
            'covered_call_count':sum(row['price_screen']['covered_call_eligible'] for row in covered),
            'other_strategy_count':sum(not row['price_screen']['covered_call_eligible'] for row in covered),
            'strategy_unverified_tickers':[row['ticker'] for row in covered if row['price_screen']['strategy']['kind'] == 'needs_verification'],
            'priority_holdings':[{
                'ticker':row['ticker'], 'annual_rate':row['payout_priority']['annual_rate'],
                'label':row.get('price_screen',{}).get('label','Price history unavailable'),
                'price_change_rate':row.get('price_screen',{}).get('price_change_rate'),
                'reference_gap_rate':row.get('price_screen',{}).get('reference_result',{}).get('capital_gap_rate'),
                'reason':row.get('price_screen',{}).get('reason',row['reason']),
            } for row in applicable if row.get('payout_priority',{}).get('priority')],
            'priority_rate_unavailable_tickers':[row['ticker'] for row in applicable if row.get('payout_priority',{}).get('status') == 'rate_unavailable'],
            'estimated_eroder_count':len(eroders),
            'estimated_eroder_value':sum(row.get('current_value') or 0 for row in eroders),
            # Listed so it is visibly accounted for, and never counted as erosion.
            'nav_lag':[{'ticker':row['ticker'], 'reference':lag['reference'], 'lag_rate':lag['lag_rate'],
                        'fund_price_change_rate':lag['fund_price_change_rate'],
                        'underlying_price_change_rate':lag['underlying_price_change_rate'],
                        'same_cash_gap_rate':lag['same_cash_gap_rate'], 'current_value':row.get('current_value'),
                        'reason':lag['reason']}
                       for row in covered for lag in [row['price_screen'].get('nav_lag') or {}] if lag.get('status') == 'lag'],
            'candidates':[{'ticker':row['ticker'], 'price_change_rate':row['price_screen']['price_change_rate'],
                           'estimated_eroder':row['price_screen']['estimated_eroder'], 'label':row['price_screen']['label'],
                           'reference_fit':row['reference']['fit'], 'strategy':row['price_screen']['strategy']['label'],
                           'reason':row['price_screen']['reason']} for row in candidates],
            'weighted_price_change_rate':weighted('price_change_rate'),
            'weighted_cash_total_return':weighted('cash_total_return'),
            'weighted_distribution_rate':weighted('distribution_rate_on_start'),
            'title':('Possible covered-call erosion detected' if eroders else
                     'Capital / strategy review indicated — no covered-call eroder established' if candidates else
                     'No covered-call erosion signal established in screened holdings' if covered else
                     'Assessment unavailable — price and NAV history missing'),
            'limitation':'Current-value-weighted holding estimates for covered funds, using each fund’s available dates. These are not historical portfolio returns or a verified NAV verdict.'}

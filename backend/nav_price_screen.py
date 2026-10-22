"""Preliminary fund screening from traded prices, kept separate from fund NAV.

Inputs are split-restated closes and distributions on the same share basis.
They must never be relabeled as published NAV, including for BDCs and CEFs.
"""
import datetime as dt
import calendar

# Explicit review-policy thresholds, not fitted probabilities or a claim that
# smaller losses cannot matter. Completed payout cycles limit ex-date noise.
INTERVAL_DECLINE = .0025
INTERVAL_GAP = .0025
WINDOW_DECLINE = .01
WINDOW_GAP = .005

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


def screen(source, start, end, plan, reference_loader):
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
    eligible = strategy['kind'] == 'covered_call'
    eroder = candidate and persistence['both_repeated'] and eligible
    label = ('Estimated covered-call eroder' if eroder else
             'Covered-call review' if candidate and eligible else
             'Capital / payout review' if candidate else
             'No covered-call erosion signal' if eligible and persistence['supportive_intervals'] >= 2 else
             'Covered-call screen: limited evidence' if eligible else
             'Strategy needs verification' if strategy['kind'] == 'needs_verification' else 'Capital / payout context')
    reason = (f'Repeated material price declines and same-cash shortfalls in flat/rising reference months. '
              f'{"Payouts also exceeded reference returns repeatedly; investigate possible covered-call erosion." if eroder else "Review strategy, payouts and reference fit; this is not an eroder classification."}' if candidate else
              'The fund retained at least as much capital as the reference after matching the same payouts; a high payout alone is not an erosion signal.' if ref.get('status') == 'available' and ref.get('capital_gap_rate',-1) >= 0 else
              'Insufficient completed months with a flat/rising reference to establish persistence.' if persistence['supportive_intervals'] < 2 else
              'The material, persistent price-and-reference shortfall rule was not met.')
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
            'estimated_eroder':bool(eroder), 'label':label, 'reason':reason,
            'limitation':'Preliminary price-based estimate. Premiums/discounts, exposure differences and payout timing can affect it; this is not verified NAV erosion.'}


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

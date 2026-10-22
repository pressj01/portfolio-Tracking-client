import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from nav_price_screen import screen
from nav_assessment_service import build_payload, guidance, reference_plan


def example(price_growth=-.003, reference_growth=.0001, amount=4):
    start,end=dt.date(2025,12,31),dt.date(2026,9,30)
    days=[start+dt.timedelta(days=i) for i in range((end-start).days+1)]
    days=[day for day in days if day.weekday()<5]
    prices=[{'date':day.isoformat(),'close':100*(1+price_growth)**i} for i,day in enumerate(days)]
    refs={day.isoformat():100*(1+reference_growth)**i for i,day in enumerate(days)}
    src={'basis':'split_adjusted_market_price','prices':prices,
         'distributions':[{'date':day.isoformat(),'amount':amount} for day in days if day.day==15],
         'distributions_complete':True,'corporate_actions_resolved':True,'provider':'fixture'}
    return src,start,end,lambda *a:refs


class PriceScreenTest(unittest.TestCase):
    def run_screen(self,**kwargs):
        src,start,end,loader=example(**kwargs)
        plan=reference_plan('ULTI',{},guidance('ULTI',{}))
        return screen(src,start,end,plan,loader)

    def test_proxy_reference_can_screen_without_becoming_verified_nav(self):
        result=self.run_screen()
        self.assertTrue(result['review_candidate'])
        self.assertTrue(result['estimated_eroder'])
        self.assertEqual(result['label'],'Estimated covered-call eroder')
        self.assertFalse(result['published_nav'])
        self.assertEqual(result['basis'],'market_price')
        self.assertEqual(result['persistence']['cadence'],'month')

    def test_falling_underlying_does_not_qualify(self):
        result=self.run_screen(reference_growth=-.002)
        self.assertFalse(result['review_candidate'])
        self.assertFalse(result['estimated_eroder'])
        self.assertEqual(result['persistence']['qualifying_intervals'],0)

    def test_both_conditions_required_for_eroder_label(self):
        result=self.run_screen(reference_growth=.001,amount=.01)
        self.assertTrue(result['review_candidate'])
        self.assertFalse(result['estimated_eroder'])
        self.assertEqual(result['persistence']['joint_qualifying_intervals'],0)

    def test_two_consecutive_joint_intervals_qualify_without_majority_of_all_months(self):
        src,start,end,loader=example()
        # Two consecutive decline episodes amid otherwise rising prices.
        for row in src['prices']:
            day=dt.date.fromisoformat(row['date'])
            month_offset=(day.year-start.year)*12+day.month-start.month
            levels=[100,102,104,106,108,110,112,90,70,72]
            row['close']=levels[min(month_offset,len(levels)-1)]
        month_ends={row['date'][:7]:row['date'] for row in src['prices']}
        src['distributions']=[{'date':day,'amount':10 if day[5:7] in ('07','08') else .01} for day in month_ends.values()]
        result=screen(src,start,end,reference_plan('ULTI',{},guidance('ULTI',{})),loader)
        self.assertEqual(result['persistence']['consecutive_joint_intervals'],2)
        self.assertTrue(result['estimated_eroder'])

    def test_rising_fund_not_eroder_even_if_payout_above_reference_return(self):
        result=self.run_screen(price_growth=.0005,reference_growth=0,amount=4)
        self.assertFalse(result['review_candidate'])
        self.assertFalse(result['estimated_eroder'])

    def test_reference_outage_does_not_erase_numeric_price_metrics(self):
        src,start,end,_=example()
        result=screen(src,start,end,reference_plan('ULTI',{},guidance('ULTI',{})),lambda *a:{})
        self.assertEqual(result['status'],'available')
        self.assertLess(result['price_change_rate'],0)
        self.assertFalse(result['estimated_eroder'])
        self.assertEqual(result['persistence']['intervals_compared'],0)

    def test_latest_missing_reference_bar_uses_common_close_and_reports_dates(self):
        src,start,end,loader=example()
        refs=loader();refs.pop(end.isoformat())
        result=screen(src,start,end,reference_plan('ULTI',{},guidance('ULTI',{})),lambda *a:refs)
        self.assertTrue(result['reference_aligned_end'])
        self.assertEqual(result['end'],'2026-09-29')
        self.assertEqual(result['reference_result']['status'],'available')

    def test_short_range_cannot_convert_payout_weeks_into_monthly_persistence(self):
        src,start,end,loader=example()
        start=dt.date(2026,9,1)
        result=screen(src,start,end,reference_plan('ULTI',{},guidance('ULTI',{})),loader)
        self.assertEqual(result['persistence']['cadence'],'month')
        self.assertFalse(result['review_candidate'])
        short=screen(src,dt.date(2026,9,23),end,reference_plan('ULTI',{},guidance('ULTI',{})),loader)
        self.assertFalse(short['review_candidate'])

    def test_paying_more_than_reference_is_not_erosion_when_fund_earns_more(self):
        result=self.run_screen(price_growth=-.0002,reference_growth=.0001,amount=3)
        self.assertLess(result['price_change_rate'],-.01)
        self.assertGreater(result['persistence']['payout_above_reference_intervals'],1)
        self.assertGreater(result['reference_result']['capital_gap_rate'],0)
        self.assertFalse(result['review_candidate'])
        self.assertFalse(result['estimated_eroder'])

    def test_small_monthly_price_dips_do_not_qualify_even_when_net_decline_is_visible(self):
        result=self.run_screen(price_growth=-.00009,reference_growth=0,amount=.15)
        self.assertLess(result['price_change_rate'],-.01)
        self.assertEqual(result['persistence']['qualifying_intervals'],0)
        self.assertFalse(result['estimated_eroder'])

    def test_bond_and_put_strategies_keep_metrics_and_get_capital_review_not_call_eroder(self):
        src,start,end,loader=example()
        for ticker in ('CSHI','LQID','HYBI','FBDC'):
            with self.subTest(ticker=ticker):
                plan=reference_plan(ticker,{},guidance(ticker,{}),{'mode':'symbol','symbol':'QQQ'})
                result=screen(src,start,end,plan,loader)
                self.assertEqual(result['status'],'available')
                self.assertTrue(result['review_candidate'])
                self.assertFalse(result['covered_call_eligible'])
                self.assertFalse(result['estimated_eroder'])
                self.assertEqual(result['label'],'Capital / payout review')

    def test_call_spread_funds_are_eligible_without_high_payout_being_a_verdict(self):
        src,start,end,loader=example(price_growth=.0005,amount=4)
        for ticker in ('CHPY','GPTY','CEPI','QVOL','XSHP','TDAQ','TSPY','TDAX','TMGN'):
            with self.subTest(ticker=ticker):
                result=screen(src,start,end,reference_plan(ticker,{},guidance(ticker,{})),loader)
                self.assertTrue(result['covered_call_eligible'])
                self.assertFalse(result['estimated_eroder'])

    def test_priority_rate_is_current_snapshot_and_crypto_exclusion_is_not_missing_data(self):
        src,start,end,loader=example(price_growth=.0005)
        holdings={t:{'current_value':100,'quantity':1,'annual_income':income} for t,income in (
            ('CHPY',40),('GPTY',15.01),('SPYI',15),('CEPI',40),('BTCI',40),('ISBG',40),('LQID',6))}
        holdings['QVOL']={'current_value':100,'quantity':1}
        payload=build_payload(holdings,lambda *a:None,loader,as_of=end,start_date=start,market_loader=lambda *a:src)
        self.assertEqual({r['ticker'] for r in payload['preliminary']['priority_holdings']},{'CHPY','GPTY'})
        self.assertIn('QVOL',payload['preliminary']['priority_rate_unavailable_tickers'])
        self.assertEqual(payload['preliminary']['covered_count'],8)
        self.assertEqual(payload['preliminary']['estimated_eroder_count'],0)
        rows={r['ticker']:r for r in payload['results']}
        self.assertEqual(rows['ISBG']['payout_priority']['status'],'crypto_excluded')
        self.assertEqual(rows['SPYI']['payout_priority']['status'],'below_threshold')

    def test_long_selected_range_checks_all_completed_months_not_only_recent_six(self):
        result=self.run_screen()
        self.assertEqual(len(result['persistence']['windows']),9)
        self.assertEqual(result['persistence']['windows'][0]['start'],'2025-12-31')

    def test_missing_dividend_or_split_checks_do_not_become_zero_payouts(self):
        for field in ('distributions_complete','corporate_actions_resolved'):
            src,start,end,loader=example();src[field]=False
            self.assertEqual(screen(src,start,end,{},loader)['status'],'unavailable')

    def test_future_data_excluded_and_payout_accounting_not_double_counted(self):
        src,start,end,loader=example()
        result=screen(src,start,dt.date(2026,6,30),reference_plan('ULTI',{},guidance('ULTI',{})),loader)
        expected=sum(row['amount'] for row in src['distributions'] if row['date']<='2026-06-30')
        self.assertEqual(result['cash_paid'],expected)
        self.assertAlmostEqual(result['cash_total_return'],result['price_change_rate']+result['distribution_rate_on_start'])
        self.assertLessEqual(result['end'],'2026-06-30')

    def test_price_estimate_does_not_change_nav_status_or_remove_missing_exposure(self):
        src,start,end,loader=example()
        payload=build_payload({'ULTI':{'current_value':100,'quantity':1}},lambda *a:None,loader,
                              as_of=end,start_date=start,market_loader=lambda *a:src)
        row=payload['results'][0]
        self.assertEqual(row['capital_status'],'unconfirmed')
        self.assertIsNone(row['metrics'])
        self.assertTrue(row['price_screen']['estimated_eroder'])
        self.assertEqual(payload['preliminary']['value_coverage'],1)
        self.assertEqual(payload['preliminary']['estimated_eroder_count'],1)
        self.assertEqual(payload['preliminary']['estimated_eroder_value'],100)
        self.assertEqual(payload['preliminary']['estimated_eroder_account_share'],1)
        self.assertEqual(payload['preliminary']['title'],'Possible covered-call erosion detected')
        self.assertEqual(payload['overall']['assessed_count'],0)
        self.assertEqual(payload['overall']['title'],'NAV verdict unavailable — incomplete portfolio coverage')


class MarketAdapterTest(unittest.TestCase):
    def test_unfinished_latest_bar_does_not_discard_all_history(self):
        import pandas as pd
        import app
        frame=pd.DataFrame({'Close':[10.,11.,float('nan')],'Adj Close':[9.,11.,float('nan')],
                            'Dividends':[0.,1.,float('nan')],'Stock Splits':[0.,0.,0.]},
                           index=pd.to_datetime(['2026-01-02','2026-01-05','2026-01-06']))
        app._NAV_ASSESSMENT_PRICE_CACHE.clear()
        with patch.object(app,'_yf_ticker') as ticker:
            ticker.return_value.history.return_value=frame
            result=app._nav_screen_market_history('ULTI',dt.date(2026,1,1),dt.date(2026,1,6))
            self.assertEqual(len(result['prices']),2)
            self.assertEqual(result['omitted_price_dates'],['2026-01-06'])
            self.assertTrue(result['distributions_complete'])
            self.assertEqual(result['distributions'],[{'date':'2026-01-05','amount':1.}])
        app._NAV_ASSESSMENT_PRICE_CACHE.clear()

    def test_facade_prices_and_distributions_are_not_split_adjusted_twice(self):
        import pandas as pd
        import app
        frame=pd.DataFrame({'Close':[10.,11.],'Adj Close':[9.,11.],
                            'Dividends':[0.,1.],'Stock Splits':[0.,2.]},
                           index=pd.to_datetime(['2026-01-02','2026-01-05']))
        frame.attrs['market_data_sources']={'ULTI':'tiingo'}
        app._NAV_ASSESSMENT_PRICE_CACHE.clear()
        with patch.object(app,'_yf_ticker') as ticker:
            ticker.return_value.history.return_value=frame
            result=app._nav_screen_market_history('ULTI',dt.date(2026,1,1),dt.date(2026,1,5))
            self.assertEqual(result['prices'][0]['close'],10)
            self.assertEqual(result['distributions'][0]['amount'],1)
            self.assertEqual(result['provider'],'tiingo')
            self.assertFalse(ticker.return_value.history.call_args.kwargs['auto_adjust'])
            again=app._nav_screen_market_history('ULTI',dt.date(2026,1,1),dt.date(2026,1,5))
            self.assertEqual(ticker.return_value.history.call_count,1)
        app._NAV_ASSESSMENT_PRICE_CACHE.clear()


if __name__=='__main__':
    unittest.main()

import datetime as dt
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as module


class NavAssessmentApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name)/"test.db")
        conn = self.connect()
        conn.executescript("""
            CREATE TABLE profiles (id INTEGER PRIMARY KEY, cash_value REAL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE all_account_info (profile_id INTEGER, ticker TEXT,
                current_price REAL, quantity REAL, description TEXT, classification_type TEXT,
                estim_payment_per_year REAL, current_value REAL, nav_erosion_scope TEXT,
                nav_benchmark_override TEXT);
            INSERT INTO profiles VALUES (2, 10), (3, 20);
            INSERT INTO all_account_info VALUES
                (2, 'QQQI', 100, 1, 'ETF', 'ETF', 15, 100, 'auto', NULL),
                (3, 'QQQI', 100, 2, 'ETF', 'ETF', 30, 200, 'auto', NULL),
                (3, 'JNJ', 100, 1, 'Stock', 'G', 5, 100, 'auto', NULL);
        """)
        conn.commit()
        conn.close()
        module._NAV_ASSESSMENT_CACHE.clear()
        self.connection_patch = patch.object(module, 'get_connection', self.connect)
        self.filter_patch = patch.object(module, 'get_profile_filter', return_value=(False, [2]))
        self.cash_patch = patch.object(module, '_cash_profile_ids_for_read', side_effect=lambda conn, agg, ids: ids)
        today = dt.date.today()
        self.first, self.last = (today-dt.timedelta(days=3)).isoformat(), today.isoformat()
        self.source_patch = patch.object(module, '_nav_assessment_source', return_value={
            "basis": "published_nav", "nav": [{"date": self.first,"nav":100},{"date":self.last,"nav":90}],
            "distributions": [{"date":self.last,"amount":15}], "distributions_complete":True,
            "corporate_actions_resolved":True,
        })
        self.quote_patch = patch.object(module, '_yf_ticker', side_effect=RuntimeError('Reference down'))
        self.init_patch = patch.object(module.app, '_db_initialized', True, create=True)
        for item in (self.connection_patch,self.filter_patch,self.cash_patch,self.source_patch,self.quote_patch,self.init_patch):
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.temp.cleanup)
        self.client = module.app.test_client()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_get_uses_selected_profile_and_includes_cash(self):
        response = self.client.get('/api/nav-assessment')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual([r['ticker'] for r in data['results']], ['QQQI'])
        self.assertEqual(data['summary']['account_value'],110)
        self.assertEqual(data['results'][0]['metrics']['investment_result'],5)
        self.assertEqual(data['results'][0]['reference_result']['status'],'unavailable')

    def test_missing_current_income_is_not_treated_as_below_priority_threshold(self):
        conn=self.connect()
        conn.execute("UPDATE all_account_info SET estim_payment_per_year=NULL WHERE profile_id=2")
        conn.commit()
        conn.close()
        data=self.client.get('/api/nav-assessment').get_json()
        priority=data['results'][0]['payout_priority']
        self.assertIsNone(priority['annual_rate'])
        self.assertEqual(priority['status'],'rate_unavailable')

    def test_aggregate_deduplicates_ticker_value_without_backcasting_shares(self):
        module.get_profile_filter.return_value = (True,[2,3])
        data = self.client.get('/api/nav-assessment').get_json()
        self.assertEqual(len(data['results']),2)
        q = next(r for r in data['results'] if r['ticker']=='QQQI')
        self.assertEqual(q['current_value'],300)
        self.assertEqual(q['metrics']['investment_result'],5)
        self.assertEqual(data['summary']['account_value'],430)

    def test_reference_choices_are_persistent_and_profile_scoped(self):
        response = self.client.put('/api/nav-assessment/reference/QQQI', json={'mode':'symbol','symbol':'SPY'})
        self.assertEqual(response.status_code,200)
        first = self.client.get('/api/nav-assessment').get_json()
        self.assertEqual(first['results'][0]['reference']['selected'],'SPY')
        module.get_profile_filter.return_value = (False,[3])
        second = self.client.get('/api/nav-assessment').get_json()
        q = next(r for r in second['results'] if r['ticker']=='QQQI')
        self.assertEqual(q['reference']['selected'],'QQQ')

    def test_prior_choice_is_retained_without_changing_legacy_override(self):
        self.client.put('/api/nav-assessment/reference/QQQI', json={'mode':'symbol','symbol':'SPY'})
        self.client.put('/api/nav-assessment/reference/QQQI', json={'mode':'symbol','symbol':'QQQ'})
        conn = self.connect()
        saved = json.loads(conn.execute("SELECT value FROM settings WHERE key='nav_reference_choices_v1:p:2'").fetchone()[0])
        self.assertEqual(saved['QQQI']['history'][-1]['choice']['symbol'],'SPY')
        self.assertIsNone(conn.execute("SELECT nav_benchmark_override FROM all_account_info WHERE profile_id=2").fetchone()[0])
        conn.close()

    def test_reference_rejects_nonheld_ticker_and_bad_payload(self):
        self.assertEqual(self.client.put('/api/nav-assessment/reference/NOTHELD',json={'mode':'auto'}).status_code,404)
        self.assertEqual(self.client.put('/api/nav-assessment/reference/QQQI',json={'mode':'symbol','symbol':'https://example.com'}).status_code,400)
        self.assertEqual(self.client.get('/api/nav-assessment?window=invalid').status_code,400)

    def test_shared_ytd_uses_prior_close_baseline(self):
        year = dt.date.today().year
        baseline = f'{year-1}-12-31'
        src = module._nav_assessment_source.return_value
        src['nav'] = [{'date':baseline, 'nav':100}, {'date':self.last, 'nav':90}]
        data = self.client.get('/api/nav-assessment?period=ytd').get_json()
        self.assertTrue(data['shared_range'])
        self.assertEqual(data['window'], 'YTD')
        self.assertEqual(data['requested_start'], f'{year}-01-01')
        self.assertEqual(data['results'][0]['window_start'], baseline)
        self.assertFalse(data['results'][0]['shorter_history'])

    def test_shared_custom_dates_bound_nav_and_distributions_and_cache(self):
        module._nav_assessment_source.return_value = {
            'basis':'published_nav', 'distributions_complete':True, 'corporate_actions_resolved':True,
            'nav':[{'date':'2024-12-31','nav':100}, {'date':'2025-03-31','nav':95},
                   {'date':'2025-06-30','nav':90}, {'date':self.last,'nav':80}],
            'distributions':[{'date':'2025-03-31','amount':6}, {'date':'2025-06-30','amount':7},
                             {'date':self.last,'amount':99}],
        }
        first = self.client.get('/api/nav-assessment?period=custom&start_date=2025-01-01&end_date=2025-03-31').get_json()
        second = self.client.get('/api/nav-assessment?period=custom&start_date=2025-01-01&end_date=2025-06-30').get_json()
        self.assertEqual(first['as_of'], '2025-03-31')
        self.assertEqual(first['results'][0]['window_start'], '2024-12-31')
        self.assertEqual(first['results'][0]['metrics']['investment_result'], 1)
        self.assertEqual(second['results'][0]['metrics']['investment_result'], 3)
        self.assertEqual(second['results'][0]['window_end'], '2025-06-30')
        self.assertEqual(first['results'][0]['persistence']['quarters_compared'], 0)

    def test_shared_all_market_starts_at_portfolio_activity_including_closed_positions(self):
        conn = self.connect()
        conn.executescript("""
            ALTER TABLE all_account_info ADD COLUMN purchase_date TEXT;
            CREATE TABLE transactions (profile_id INTEGER, ticker TEXT, transaction_date TEXT);
            INSERT INTO transactions VALUES (2, 'CLOSED', '2020-02-03'), (3, 'OTHER', '2010-01-01');
        """)
        conn.commit()
        conn.close()
        data = self.client.get('/api/nav-assessment?period=all').get_json()
        self.assertEqual(data['requested_start'], '2020-02-03')
        self.assertEqual(data['period_label'], 'All Market')
        self.assertTrue(data['results'][0]['shorter_history'])

    def test_shared_range_validates_custom_and_does_not_treat_open_gl_as_market_window(self):
        for query in ('period=lifetime', 'period=custom', 'window=CUSTOM',
                      'period=custom&start_date=2025-06-30&end_date=2025-03-31',
                      'period=custom&start_date=0002-01-01&end_date=2025-03-31'):
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/nav-assessment?'+query).status_code, 400)

    def test_every_shared_preset_resolves_through_the_common_period_policy(self):
        for period in ('1d','7d','1m','3m','6m','ytd','1y','5y'):
            with self.subTest(period=period):
                data = self.client.get('/api/nav-assessment?period='+period).get_json()
                expected = module._resolve_total_return_period(period)
                self.assertEqual(data['requested_start'], expected['start_date'])
                self.assertEqual(data['as_of'], expected['end_date'])


if __name__ == '__main__':
    unittest.main()

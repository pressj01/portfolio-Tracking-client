import { NOT_FINANCIAL_ADVICE_SHORT } from '../content/notFinancialAdvice'

export function NotFinancialAdviceBanner() {
  return (
    <div className="nfa-banner" role="note" aria-label="Not financial advice">
      {NOT_FINANCIAL_ADVICE_SHORT}
    </div>
  )
}

export default function NotFinancialAdviceNotice() {
  return (
    <div className="nfa-page" role="note" aria-label="Not financial advice">
      {NOT_FINANCIAL_ADVICE_SHORT}
    </div>
  )
}

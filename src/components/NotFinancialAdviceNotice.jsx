import { useCallback, useEffect, useState } from 'react'
import {
  ADVICE_NOTICE_VISIBILITY_STORAGE_KEY,
  NOT_FINANCIAL_ADVICE_FOOTER,
  NOT_FINANCIAL_ADVICE_SHORT,
} from '../content/notFinancialAdvice'

const VISIBILITY_EVENT = 'portfolio-tracker-advice-notice-visibility'

function savedVisibility() {
  try {
    return window.localStorage.getItem(ADVICE_NOTICE_VISIBILITY_STORAGE_KEY) !== 'hidden'
  } catch {
    return true
  }
}

export function useAdviceNoticeVisibility() {
  const [visible, setVisibleState] = useState(savedVisibility)

  useEffect(() => {
    const syncVisibility = event => {
      if (event.type === 'storage' && event.key !== ADVICE_NOTICE_VISIBILITY_STORAGE_KEY) return
      setVisibleState(event.detail?.visible ?? savedVisibility())
    }
    window.addEventListener('storage', syncVisibility)
    window.addEventListener(VISIBILITY_EVENT, syncVisibility)
    return () => {
      window.removeEventListener('storage', syncVisibility)
      window.removeEventListener(VISIBILITY_EVENT, syncVisibility)
    }
  }, [])

  const setVisible = useCallback(nextValue => {
    const nextVisible = Boolean(nextValue)
    try {
      window.localStorage.setItem(
        ADVICE_NOTICE_VISIBILITY_STORAGE_KEY,
        nextVisible ? 'visible' : 'hidden',
      )
    } catch {
      // Keep the preference for this session when browser storage is blocked.
    }
    setVisibleState(nextVisible)
    window.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, { detail: { visible: nextVisible } }))
  }, [])

  return [visible, setVisible]
}

function AdviceNotice({ className, persistentFooter = false }) {
  const [visible, setVisible] = useAdviceNoticeVisibility()
  if (!visible) {
    return persistentFooter ? (
      <div className="nfa-page-footer" role="note" aria-label="Informational-purpose disclaimer">
        {NOT_FINANCIAL_ADVICE_FOOTER}
      </div>
    ) : null
  }

  return (
    <div className={className} role="note" aria-label="Not financial advice">
      <span className="nfa-notice-text">{NOT_FINANCIAL_ADVICE_SHORT}</span>
      <button
        type="button"
        className="nfa-notice-dismiss"
        aria-label="Hide educational notices"
        title="Hide these notices. You can show them again in Settings → Appearance."
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  )
}

export function NotFinancialAdviceBanner() {
  return <AdviceNotice className="nfa-banner" />
}

export default function NotFinancialAdviceNotice() {
  return <AdviceNotice className="nfa-page" persistentFooter />
}

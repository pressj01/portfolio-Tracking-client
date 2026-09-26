import { useEffect, useId, useState } from 'react'
import { ADVICE_ACK_STORAGE_KEY, NOT_FINANCIAL_ADVICE, PRIVACY_NOTE } from '../content/notFinancialAdvice'

function alreadyAccepted() {
  try {
    return window.localStorage.getItem(ADVICE_ACK_STORAGE_KEY) === 'accepted'
  } catch {
    return false
  }
}

export default function AdviceAcknowledgement() {
  const titleId = useId()
  const [open, setOpen] = useState(() => !alreadyAccepted())
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const blockEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', blockEscape, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', blockEscape, true)
    }
  }, [open])

  if (!open) return null

  const accept = () => {
    if (!checked) return
    try {
      window.localStorage.setItem(ADVICE_ACK_STORAGE_KEY, 'accepted')
    } catch {
      // Storage can be blocked. The app-wide notice still stays on screen.
    }
    setOpen(false)
  }

  return (
    <div className="nfa-ack" role="presentation">
      <div className="nfa-ack-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Before you continue</h2>
        <p>{NOT_FINANCIAL_ADVICE}</p>
        <p>{PRIVACY_NOTE}</p>
        <label className="nfa-ack-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={event => setChecked(event.target.checked)}
          />
          <span>I understand this software is not financial advice and does not promise returns.</span>
        </label>
        <button type="button" className="btn btn-primary" disabled={!checked} onClick={accept}>
          Continue
        </button>
      </div>
    </div>
  )
}

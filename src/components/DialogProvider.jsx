import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

const DialogContext = createContext(null)

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}

export default function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const inputRef = useRef(null)
  const resolveRef = useRef(null)

  const close = useCallback((value) => {
    if (resolveRef.current) resolveRef.current(value)
    resolveRef.current = null
    setDialog(null)
  }, [])

  useEffect(() => {
    if (dialog && dialog.type === 'prompt' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [dialog])

  const showAlert = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setDialog({ type: 'alert', message })
    })
  }, [])

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setDialog({ type: 'confirm', message })
    })
  }, [])

  const showPrompt = useCallback((message, defaultValue = '') => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setDialog({ type: 'prompt', message, defaultValue })
    })
  }, [])

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      close(dialog.type === 'alert' ? undefined : null)
    }
    if (e.key === 'Enter' && dialog.type !== 'prompt') {
      close(dialog.type === 'confirm' ? true : undefined)
    }
  }

  return (
    <DialogContext.Provider value={{ alert: showAlert, confirm: showConfirm, prompt: showPrompt }}>
      {children}
      {dialog && (
        <div className="dialog-overlay" onKeyDown={handleKeyDown}>
          <div className="dialog-box">
            <p className="dialog-message">{dialog.message}</p>

            {dialog.type === 'prompt' && (
              <input
                ref={inputRef}
                className="dialog-input"
                defaultValue={dialog.defaultValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') close(e.target.value)
                  if (e.key === 'Escape') close(null)
                }}
              />
            )}

            <div className="dialog-buttons">
              {dialog.type === 'alert' && (
                <button className="btn btn-primary" onClick={() => close(undefined)} autoFocus>OK</button>
              )}
              {dialog.type === 'confirm' && (
                <>
                  <button className="btn btn-secondary" onClick={() => close(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => close(true)} autoFocus>OK</button>
                </>
              )}
              {dialog.type === 'prompt' && (
                <>
                  <button className="btn btn-secondary" onClick={() => close(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => close(inputRef.current?.value || '')}>OK</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

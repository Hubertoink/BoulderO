import { useEffect, useRef } from 'react'

export function useOutsideDismiss(isOpen, onDismiss) {
  const ref = useRef(null)
  useEffect(() => {
    if (!isOpen) return undefined
    function dismiss(event) {
      if (ref.current && !ref.current.contains(event.target)) onDismiss()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [isOpen, onDismiss])
  return ref
}

export function formatFeedDate(value) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

export function formatPlanDate(value) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

import { useEffect, useRef } from 'react'

export function useOutsideDismiss(isOpen: boolean, onDismiss: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!isOpen) return undefined
    function dismiss(event: PointerEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) onDismiss()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [isOpen, onDismiss])
  return ref
}

export function formatFeedDate(value: string | number | Date): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

export function formatPlanDate(value: string | number | Date): string {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function formatPlanDateRange(startsAt: string | number | Date, endsAt?: string | number | Date | null): string {
  const start = new Date(startsAt)
  if (!endsAt) return formatPlanDate(start)
  const end = new Date(endsAt)
  const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate()
  if (!sameDay) return `${formatPlanDate(start)} – ${formatPlanDate(end)}`
  const endTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(end)
  return `${formatPlanDate(start)}–${endTime} Uhr`
}

export function formatJournalDate(value: string | number | Date): { day: string, month: string } {
  const date = new Date(value)
  return {
    day: new Intl.DateTimeFormat('de-DE', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(date).replace('.', '').toUpperCase(),
  }
}

export function timeInputValue(value: string | null | undefined): string {
  const match = String(value ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)/)
  return match ? `${match[1]}:${match[2]}` : ''
}

export function formatVisitTimeRange(startedAt: string | null | undefined, endedAt: string | null | undefined): string {
  const start = timeInputValue(startedAt)
  const end = timeInputValue(endedAt)
  if (!start) return ''
  return end ? `${start}–${end} Uhr` : `${start} Uhr`
}

import { useEffect, useRef } from 'react'

const FOCUSABLE_SEL =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard handling for modal dialogs.
 *
 * - Escape            → calls onClose
 * - Ctrl/Cmd + Enter  → calls onConfirm (if provided)
 * - Tab               → traps focus inside the container
 * - Auto-focuses the first input (or first focusable) on mount
 *
 * Attach the returned ref to the modal's inner content div (not the backdrop).
 *
 * @param {{ onClose: Function, onConfirm?: Function }} options
 * @returns {React.RefObject}
 */
export function useModalKeys({ onClose, onConfirm, enabled = true } = {}) {
  const containerRef = useRef(null)

  // Auto-focus first input or focusable element on mount
  useEffect(() => {
    if (!enabled) return undefined
    const el = containerRef.current
    if (!el) return
    const t = setTimeout(() => {
      const firstInput = el.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      const firstFocusable = el.querySelector(FOCUSABLE_SEL)
      ;(firstInput || firstFocusable)?.focus()
    }, 40)
    return () => clearTimeout(t)
  }, [enabled])

  // Escape / Ctrl+Enter / focus trap
  useEffect(() => {
    if (!enabled) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose?.()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        onConfirm?.()
        return
      }

      // Tab focus trap
      if (e.key === 'Tab') {
        const el = containerRef.current
        if (!el) return
        const nodes = [...el.querySelectorAll(FOCUSABLE_SEL)]
        if (nodes.length === 0) return
        const first = nodes[0]
        const last  = nodes[nodes.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last)  { e.preventDefault(); first.focus() }
        }
      }
    }

    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [enabled, onClose, onConfirm])

  return containerRef
}

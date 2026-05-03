/**
 * Reduced-motion helper.
 *
 * The CSS block in globals.css (under @media (prefers-reduced-motion: reduce))
 * collapses declarative transitions/animations to ~0ms. JS-driven animations
 * (RAF, setTimeout) don't see that, so they need to consult this helper at
 * decision time.
 */

/** True if the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── Legacy tokens retained for active callsites ──
        'fg-primary': 'var(--color-fg-primary)',
        'fg-muted':   'var(--color-fg-muted)',
        'ansi-red': '#FF5555',
        'ansi-green': '#50FA7B',
        'ansi-cyan': '#8BE9FD',
        'terminal-bg': 'var(--color-bg-canvas)',
        'surface': 'var(--color-bg-surface)',
        'raised':  'var(--color-bg-raised)',
        'header-bg': 'var(--color-bg-surface)',

        // ── New design-system tokens (CSS-var-backed, theme-aware) ──
        // Surfaces
        'canvas':  'var(--color-bg-canvas)',
        'overlay': 'var(--color-bg-overlay)',
        'sunken':  'var(--color-bg-sunken)',

        // Foregrounds
        'fg-secondary': 'var(--color-fg-secondary)',
        'fg-subtle':    'var(--color-fg-subtle)',
        'fg-on-accent': 'var(--color-fg-on-accent)',

        // Borders
        'border-subtle': 'var(--color-border-subtle)',
        'border-strong': 'var(--color-border-strong)',

        // Accent
        'accent':        'var(--color-accent)',
        'accent-hover':  'var(--color-accent-hover)',
        'accent-active': 'var(--color-accent-active)',
        'accent-subtle': 'var(--color-accent-subtle)',
        'focus-ring':    'var(--color-focus-ring)',

        // Brand (warm terracotta identity layer — distinct from interactive accent)
        'brand':         'var(--color-brand)',
        'brand-hover':   'var(--color-brand-hover)',
        'brand-active':  'var(--color-brand-active)',
        'brand-soft':    'var(--color-brand-soft)',
        'brand-soft-fg': 'var(--color-brand-soft-fg)',

        // Pane statuses (new, CSS-var-backed)
        'status-needs-input-v2': 'var(--color-status-needs-input)',
        'status-done-v2':        'var(--color-status-done)',
        'status-lost':           'var(--color-status-lost)',

        // Semantic messaging
        'info-subtle-bg':    'var(--color-info-subtle-bg)',
        'info-fg':           'var(--color-info-fg)',
        'success-subtle-bg': 'var(--color-success-subtle-bg)',
        'success-fg':        'var(--color-success-fg)',
        'warning-subtle-bg': 'var(--color-warning-subtle-bg)',
        'warning-fg':        'var(--color-warning-fg)',
        'danger-subtle-bg':  'var(--color-danger-subtle-bg)',
        'danger-fg':         'var(--color-danger-fg)',
      },
      fontFamily: {
        sans:    'var(--font-sans)',
        display: 'var(--font-display)',
        mono:    'var(--font-mono)',
      },
      fontSize: {
        'micro': ['11px', { lineHeight: '1.20', letterSpacing: '0.02em' }],
        'xs':    ['12px', { lineHeight: '1.35', letterSpacing: '0.01em' }],
        'sm':    ['13px', { lineHeight: '1.45', letterSpacing: '0' }],
        'md':    ['15px', { lineHeight: '1.45', letterSpacing: '-0.005em' }],
        'lg':    ['18px', { lineHeight: '1.30', letterSpacing: '-0.01em' }],
        '2xl':   ['28px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'display-sm': ['32px', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        'display-md': ['44px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-lg': ['56px', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
      },
      fontWeight: {
        body:        'var(--font-weight-body)',
        'body-emph': 'var(--font-weight-body-emph)',
        label:       'var(--font-weight-label)',
        title:       'var(--font-weight-title)',
        hero:        'var(--font-weight-hero)',
        display:     'var(--font-weight-display)',
      },
      borderRadius: {
        'none': '0',
        'sm':   '4px',
        DEFAULT: '4px',
        'md':   '6px',
        'lg':   '10px',
        'xl':   '14px',
        '2xl':  '16px',
        'full': '9999px',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
      },
      transitionDuration: {
        instant: '80ms',
        fast:    '150ms',
        base:    '200ms',
        medium:  '300ms',
        slow:    '450ms',
      },
      transitionTimingFunction: {
        'out':    'cubic-bezier(0.2, 0.8, 0.2, 1)',
        'in':     'cubic-bezier(0.4, 0, 1, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      zIndex: {
        base:    '0',
        raised:  '10',
        overlay: '20',
        popover: '30',
        modal:   '40',
        toast:   '50',
      },
      animation: {
        'border-pulse':         'border-pulse 1s ease-in-out infinite',
        'status-working-pulse': 'status-working-pulse 1.4s ease-in-out infinite',
      },
      keyframes: {
        'border-pulse': {
          '0%, 100%': { borderColor: 'transparent' },
          '50%':      { borderColor: 'var(--flash-color)' },
        },
        'status-working-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.92' },
        },
      },
    }
  },
  plugins: []
} satisfies Config

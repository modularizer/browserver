/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './apps/*/src/**/*.{ts,tsx}',
    './packages/*/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bs: {
          bg: 'var(--bs-bg)',
          'bg-panel': 'var(--bs-bg-panel)',
          'bg-sidebar': 'var(--bs-bg-sidebar)',
          'bg-editor': 'var(--bs-bg-editor)',
          'bg-input': 'var(--bs-bg-input)',
          'bg-hover': 'var(--bs-bg-hover)',
          'bg-active': 'var(--bs-bg-active)',
          'bg-badge': 'var(--bs-bg-badge)',
          border: 'var(--bs-border)',
          'border-focus': 'var(--bs-border-focus)',
          text: 'var(--bs-text)',
          'text-muted': 'var(--bs-text-muted)',
          'text-faint': 'var(--bs-text-faint)',
          'text-inverse': 'var(--bs-text-inverse)',
          accent: 'var(--bs-accent)',
          'accent-hover': 'var(--bs-accent-hover)',
          'accent-text': 'var(--bs-accent-text)',
          good: 'var(--bs-good)',
          warn: 'var(--bs-warn)',
          error: 'var(--bs-error)',
          info: 'var(--bs-info)',
          'call-active': 'var(--bs-call-active)',
          'log-stream': 'var(--bs-log-stream)',
          'peer-online': 'var(--bs-peer-online)',
          'peer-offline': 'var(--bs-peer-offline)',
          'tab-active': 'var(--bs-tab-active)',
          'tab-inactive': 'var(--bs-tab-inactive)',
          'tab-hover': 'var(--bs-tab-hover)',
        },
      },
    },
  },
  plugins: [],
}

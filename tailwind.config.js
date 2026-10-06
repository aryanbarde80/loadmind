/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        void: {
          950: '#04060b',
          900: '#070a12',
          850: '#0a0e18',
          800: '#0d1220',
          750: '#111827',
          700: '#161d2e',
          600: '#1e2740',
        },
        neon: {
          cyan: '#22d3ee',
          mint: '#34e5b0',
          violet: '#8b7cf6',
          amber: '#fbbf24',
          rose: '#fb5a7a',
          blue: '#3b9dfd',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.18), 0 0 32px -8px rgba(34,211,238,0.35)',
        'glow-violet': '0 0 0 1px rgba(139,124,246,0.22), 0 0 36px -10px rgba(139,124,246,0.45)',
        panel: '0 24px 60px -30px rgba(0,0,0,0.9), inset 0 1px 0 0 rgba(255,255,255,0.04)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(34,211,238,0.35)' },
          '70%': { boxShadow: '0 0 0 12px rgba(34,211,238,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,211,238,0)' },
        },
        'sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'drift': {
          '0%,100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(2%, -3%, 0)' },
        },
        'blink': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.25' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.4,0,0.6,1) infinite',
        sweep: 'sweep 2.6s linear infinite',
        'fade-up': 'fade-up 0.35s ease-out both',
        drift: 'drift 22s ease-in-out infinite',
        blink: 'blink 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

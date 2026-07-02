import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Base surfaces — dark ops theme
        bg: {
          base: '#0a0a0f',       // main background
          surface: '#111118',    // card / panel surface
          elevated: '#16161f',   // elevated panel
          border: '#1e1e2e',     // borders
        },
        // Text
        text: {
          primary: '#e2e8f0',
          muted: '#64748b',
          dim: '#334155',
        },
        // Node type accent colors
        node: {
          service: '#6366f1',   // indigo
          error: '#f43f5e',     // rose
          step: '#f59e0b',      // amber
          outcome: '#10b981',   // emerald
          pattern: '#8b5cf6',   // violet
        },
        // Animation state accents
        recall: '#f97316',      // orange — traversal
        learn: '#6366f1',       // indigo — learn pulse
        improve: {
          up: '#22c55e',        // green — step worked
          down: '#ef4444',      // red — step failed
        },
      },
      fontFamily: {
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-right': 'slideRight 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideRight: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config

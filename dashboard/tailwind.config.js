/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        jp: ['"Noto Serif JP"', 'serif'],
      },
      animation: {
        'spiral-slow': 'spiral 90s linear infinite',
        'spiral-reverse': 'spiral-reverse 120s linear infinite',
        'tomoe-spin': 'spiral 24s linear infinite',
        'drift': 'drift 30s ease-in-out infinite',
        'pulse-void': 'pulse-void 9s ease-in-out infinite',
        'breathe': 'breathe 8s ease-in-out infinite',
      },
      keyframes: {
        spiral: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'spiral-reverse': {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate(0,0)' },
          '50%': { transform: 'translate(6px,-8px)' },
        },
        'pulse-void': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.5' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.55' },
          '50%': { transform: 'scale(1.03)', opacity: '0.75' },
        },
      },
    },
  },
  plugins: [],
}

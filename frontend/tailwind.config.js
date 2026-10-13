/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#ffffff',
        surface: '#f8fafc',
        line: '#e2e8f0',
        royal: '#2563eb',
        mint: '#10b981',
        lilac: '#ede9fe',
      },
      boxShadow: {
        card: '0 4px 20px -4px rgba(0,0,0,0.03)',
        'card-hover': '0 10px 30px -4px rgba(0,0,0,0.06)',
        glow: '0 0 28px rgba(37,99,235,0.12)',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { '0%': { opacity: '0', transform: 'translateX(14px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
      },
      animation: {
        fadeIn: 'fadeIn 350ms ease-out both',
        slideIn: 'slideIn 240ms ease-out both',
      },
    },
  },
  plugins: [],
}

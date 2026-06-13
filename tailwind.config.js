/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#101c18',
          DEFAULT: '#0f766e',
          light: '#14b8a6',
          surface: '#f7f6f2',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      boxShadow: {
        nav: '0 -4px 24px -8px rgba(15, 23, 42, 0.12)',
        card: '0 8px 30px -18px rgba(15, 23, 42, 0.28)',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'selector',
  theme: {
    extend: {
      colors: {
        // Theme-aware colors using CSS custom properties
        // Light theme (default), dark theme overrides with .dark class
        // All colors meet WCAG 2.1 AA contrast requirements (4.5:1 minimum)
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        border: 'var(--color-border)',
        accent: '#005ea2', // Logo blue (same across themes)
        'accent-hover': '#0071bc', // Lighter blue for hover (same across themes)
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

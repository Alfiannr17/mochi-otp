/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'mochi-green': '#D4FF00', // Sesuaikan dengan hex code warna hijau di gambarmu
        'mochi-bg': '#FDFCF0', // Warna background krem
      },
      boxShadow: {
        'neo': '4px 4px 0px 0px rgba(0,0,0,1)', // Shadow tebal khas neo-brutalism
      }
    },
  },
  plugins: [],
}
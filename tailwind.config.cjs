/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./electron/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "comfy-bg": "#0b1220",
      },
    },
  },
  plugins: [],
};

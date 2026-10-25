export default {
  plugins: {
    tailwindcss: { config: new URL("./tailwind.config.js", import.meta.url).pathname },
    autoprefixer: {},
  },
};

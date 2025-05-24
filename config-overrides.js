// config-overrides.js
module.exports = function override(config, env) {
  console.log('--- config-overrides.js is being executed ---'); // Keep this for verification!

  // Find the PostCSS loader and configure its plugins
  const cssRules = config.module.rules.find(rule => Array.isArray(rule.oneOf));
  if (cssRules) {
    const postcssLoader = cssRules.oneOf.find(
      rule => rule.use && rule.use.find(loader => loader.loader && loader.loader.includes('postcss-loader'))
    );

    if (postcssLoader) {
      postcssLoader.use[postcssLoader.use.length - 1].options.postcssOptions = {
        plugins: [
          // ************************************************
          // ************ CRITICAL CORRECTION HERE **********
          // ************************************************
          require('@tailwindcss/postcss'), // THIS IS THE CORRECT PLUGIN TO USE
          require('autoprefixer'),
          // Add other PostCSS plugins here if needed
        ],
      };
    }
  }
  return config;
};
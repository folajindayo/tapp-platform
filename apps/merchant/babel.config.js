module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Reanimated must be the last plugin per the Reanimated docs.
      'react-native-reanimated/plugin',
    ],
  };
};

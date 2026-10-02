module.exports = {
  preset: '@react-native/jest-preset',
  // Only the React Native smoke tests; src/**/*.test.ts are node:test suites.
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
};

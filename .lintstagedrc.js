module.exports = {
  // TypeScript and JavaScript files
  'app/**/*.{ts,js}': [
    'eslint --fix',
    'prettier --write'
  ],

  // JSON files
  'app/**/*.{json}': [
    'prettier --write'
  ],
}

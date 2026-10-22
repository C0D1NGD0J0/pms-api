// Jest stand-in for puppeteer (ESM-only since v25, which Jest's CommonJS runtime can't load).
// Tests mock PdfGeneratorService; anything that reaches a real browser launch fails loudly.
const launch = () => {
  throw new Error('puppeteer is stubbed in tests — mock PdfGeneratorService instead');
};

export default { launch };
export { launch };

export interface ExtractedAmount {
  price: number;
  currency: string;
  rawMatch: string;
  isTotalProposal: boolean;
  isPercentage: boolean;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'C$': 'CAD',
  'A$': 'AUD',
};

/**
 * Normalizes currency codes/symbols into standard 3-letter ISO code
 */
export function normalizeCurrency(curr?: string): string {
  if (!curr) return 'USD';
  const trimmed = curr.trim().toUpperCase();
  if (CURRENCY_SYMBOLS[curr]) return CURRENCY_SYMBOLS[curr];
  if (CURRENCY_SYMBOLS[trimmed]) return CURRENCY_SYMBOLS[trimmed];
  return trimmed;
}

/**
 * Extracts structured monetary values and proposals from freeform text
 */
export function extractPrices(text: string): ExtractedAmount[] {
  const results: ExtractedAmount[] = [];

  // 1. Matches $10,000, $10k, $12.5k, €5,000, etc.
  const symbolPattern = /([$€£¥₹]|C\$|A\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(k|m|thousand|million)?\b/gi;
  let match: RegExpExecArray | null;

  while ((match = symbolPattern.exec(text)) !== null) {
    const symbol = match[1];
    let numStr = match[2].replace(/,/g, '');
    let multiplier = 1;
    const suffix = (match[3] || '').toLowerCase();
    if (suffix === 'k' || suffix === 'thousand') multiplier = 1000;
    if (suffix === 'm' || suffix === 'million') multiplier = 1000000;

    const baseVal = parseFloat(numStr);
    if (!isNaN(baseVal)) {
      results.push({
        price: Math.round(baseVal * multiplier * 100) / 100,
        currency: normalizeCurrency(symbol),
        rawMatch: match[0],
        isTotalProposal: true,
        isPercentage: false,
      });
    }
  }

  // 2. Matches "10,000 USD", "5000 EUR", "12k USD"
  const suffixPattern = /\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(k|m|thousand)?\s*(USD|EUR|GBP|JPY|INR|CAD|AUD|dollars|bucks)\b/gi;
  while ((match = suffixPattern.exec(text)) !== null) {
    let numStr = match[1].replace(/,/g, '');
    let multiplier = 1;
    const suffix = (match[2] || '').toLowerCase();
    if (suffix === 'k' || suffix === 'thousand') multiplier = 1000;
    if (suffix === 'm') multiplier = 1000000;

    let curr = match[3].toUpperCase();
    if (curr === 'DOLLARS' || curr === 'BUCKS') curr = 'USD';

    const baseVal = parseFloat(numStr);
    if (!isNaN(baseVal)) {
      // Avoid duplicate matches if already captured by symbol regex
      const val = Math.round(baseVal * multiplier * 100) / 100;
      const alreadyCaptured = results.some(r => Math.abs(r.price - val) < 0.01 && r.currency === curr);
      if (!alreadyCaptured) {
        results.push({
          price: val,
          currency: normalizeCurrency(curr),
          rawMatch: match[0],
          isTotalProposal: true,
          isPercentage: false,
        });
      }
    }
  }

  // 3. Matches standalone numbers in clear price contexts: e.g. "cost will be 7500", "budget is 8000"
  const contextualPattern = /(?:cost|price|budget|rate|fee|total|quote|pay|amount)\s+(?:is|of|will be|to|around|at)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(k)?\b/gi;
  while ((match = contextualPattern.exec(text)) !== null) {
    let numStr = match[1].replace(/,/g, '');
    let multiplier = (match[2] || '').toLowerCase() === 'k' ? 1000 : 1;
    const baseVal = parseFloat(numStr);
    if (!isNaN(baseVal) && baseVal > 10) {
      const val = Math.round(baseVal * multiplier * 100) / 100;
      const alreadyCaptured = results.some(r => Math.abs(r.price - val) < 0.01);
      if (!alreadyCaptured) {
        results.push({
          price: val,
          currency: 'USD', // Default when currency not specified but context indicates price
          rawMatch: match[0],
          isTotalProposal: true,
          isPercentage: false,
        });
      }
    }
  }

  return results;
}

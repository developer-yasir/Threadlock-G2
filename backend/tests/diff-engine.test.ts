import { describe, expect, it } from 'vitest';
import { DiffEngine } from '../src/diff-engine/index.js';
import { extractPrices } from '../src/diff-engine/currency-parser.js';
import { extractDeadlines, getDaysDifference } from '../src/diff-engine/deadline-parser.js';
import { compareScope } from '../src/diff-engine/scope-comparator.js';
import { evaluateCustomRules } from '../src/diff-engine/rules-engine.js';
import { detectSemanticDrift } from '../src/diff-engine/semantic-detector.js';

describe('Diff Engine - Currency & Price Parsing', () => {
  it('should parse standard symbols ($10,000, €5,000)', () => {
    const res1 = extractPrices('The total price is $10,000 for this milestone.');
    expect(res1.length).toBeGreaterThan(0);
    expect(res1[0].price).toBe(10000);
    expect(res1[0].currency).toBe('USD');

    const res2 = extractPrices('We offer €5,500 EUR for the project.');
    expect(res2.length).toBeGreaterThan(0);
    expect(res2[0].price).toBe(5500);
    expect(res2[0].currency).toBe('EUR');
  });

  it('should parse abbreviations like $12k and 15k USD', () => {
    const res = extractPrices('Counter-offer is $12.5k, let us know.');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].price).toBe(12500);
  });
});

describe('Diff Engine - Deadline Parsing', () => {
  it('should parse explicit ISO and text dates', () => {
    const d1 = extractDeadlines('Delivery is set for 2026-11-30.');
    expect(d1.length).toBeGreaterThan(0);
    expect(d1[0].isoDate).toBe('2026-11-30');

    const d2 = extractDeadlines('Need this finished by Nov 30, 2026 please.');
    expect(d2.length).toBeGreaterThan(0);
    expect(d2[0].isoDate).toBe('2026-11-30');
  });

  it('should correctly calculate days difference', () => {
    const diff = getDaysDifference('2026-11-30', '2026-12-14');
    expect(diff).toBe(14);
  });

  it('should detect deadline removal expressions', () => {
    const res = extractDeadlines('Let us remove deadline and work whenever ready.');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].isRemoval).toBe(true);
  });
});

describe('Diff Engine - Scope & Custom Rules', () => {
  it('should detect scope creep additions', () => {
    const baseline = ['Landing page design', 'Stripe checkout integration'];
    const text = 'Sounds good, can you also include mobile responsive app and admin panel?';
    const result = compareScope(baseline, text);
    expect(result.hasCreep).toBe(true);
    expect(result.creptItems.length).toBeGreaterThan(0);
  });

  it('should detect scope removals', () => {
    const baseline = ['User onboarding flow', 'Email notifications'];
    const text = "We'll drop user onboarding flow to save time.";
    const result = compareScope(baseline, text);
    expect(result.hasRemoval).toBe(true);
  });

  it('should enforce custom rules', () => {
    const rules = [
      {
        id: 'r1',
        name: 'Max Revisions',
        description: 'No unlimited revisions allowed',
        forbiddenKeywords: ['unlimited revisions', 'free revisions forever'],
        severity: 'HIGH' as const,
      },
    ];
    const violations = evaluateCustomRules(rules, 'We expect unlimited revisions until we are fully satisfied.');
    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('r1');
    expect(violations[0].severity).toBe('HIGH');
  });
});

describe('Diff Engine - Full Evaluation & G2 Glance Formatting', () => {
  const engine = new DiffEngine();

  const baselineTerms = {
    price: 10000,
    currency: 'USD',
    deadline: '2026-11-30',
    scope: ['Web platform MVP', 'Database setup', 'Authentication'],
  };
  const baselineSummary = 'Build Web platform MVP with DB setup and Auth for $10,000 USD due 2026-11-30.';

  it('should detect price drift (increase)', async () => {
    const incoming = 'We revised the quote: total cost will be $11,500 USD.';
    const result = await engine.evaluate(baselineTerms, baselineSummary, incoming);

    expect(result.hasDrift).toBe(true);
    expect(result.severity).toBe('HIGH');
    expect(result.structuredDiffs.some(d => d.driftType === 'PRICE_INCREASE')).toBe(true);

    // G2 576x288 Glance Alert check
    expect(result.glance.headlineDiff).toContain('1,500');
    expect(result.glance.oldValue).toContain('10,000');
    expect(result.glance.newValue).toContain('11,500');
    expect(result.glance.recommendedAction).toBe('FLAG');
    expect(result.glance.g2Lines.length).toBeLessThanOrEqual(6);
  });

  it('should detect deadline drift (extension)', async () => {
    const incoming = 'Due to dependencies, delivery is pushed to 2026-12-14.';
    const result = await engine.evaluate(baselineTerms, baselineSummary, incoming);

    expect(result.hasDrift).toBe(true);
    expect(result.structuredDiffs.some(d => d.driftType === 'DEADLINE_EXTENDED')).toBe(true);
    expect(result.glance.headlineDiff).toContain('14 days');
  });

  it('should detect currency mismatch', async () => {
    const incoming = 'We will pay €10,000 for this project.';
    const result = await engine.evaluate(baselineTerms, baselineSummary, incoming);

    expect(result.hasDrift).toBe(true);
    expect(result.structuredDiffs.some(d => d.driftType === 'CURRENCY_MISMATCH')).toBe(true);
    expect(result.severity).toBe('HIGH');
  });

  it('should identify non-drifting confirmation messages (clean agreement)', async () => {
    const incoming = 'Everything looks perfect, agreed! Let us proceed with the $10,000 USD budget and Nov 30 deadline.';
    const result = await engine.evaluate(baselineTerms, baselineSummary, incoming);

    expect(result.hasDrift).toBe(false);
    expect(result.glance.headlineDiff).toBe('LOCKED: ZERO DRIFT');
    expect(result.glance.recommendedAction).toBe('ACCEPT_LOCK');
    expect(result.glance.driftTypes).toContain('CONFIRMATION_MATCH');
  });

  it('should detect sneaky semantic drift (retainage / delayed payout)', async () => {
    const incoming = 'Looks good, but we will pay on Net 90 terms holding retainage of 20%.';
    const result = await engine.evaluate(baselineTerms, baselineSummary, incoming);

    expect(result.hasDrift).toBe(true);
    expect(result.semanticDrift?.detected).toBe(true);
    expect(result.glance.driftTypes).toContain('SEMANTIC_DRIFT');
  });
});

import { DriftSeverity, SemanticDriftResult } from '../types/index.js';

/**
 * Confirmation signals that mean the counterparty explicitly agrees to baseline terms
 */
const CONFIRMATION_PHRASES = [
  /\b(?:sounds good|sounds great|looks good|looks great|agreed|i agree|we agree|confirmed|deal|let's do it|let's proceed|let's roll|approved|approve the terms|all looks good|locked in|pleasure doing business|ready to sign|signing now)\b/i,
  /\b(?:terms look good|terms are fine|accepted the offer|accept your terms|perfect, proceed|good to go)\b/i,
];

/**
 * Heuristic semantic drift indicators
 */
interface SemanticDriftHeuristic {
  category: string;
  pattern: RegExp;
  reason: string;
  severity: DriftSeverity;
}

const SEMANTIC_HEURISTICS: SemanticDriftHeuristic[] = [
  {
    category: 'PAYMENT_DELAY',
    pattern: /\b(?:net\s*(?:45|60|90|120)|pay after 60 days|pay upon our client's payment|contingent on funding|delayed payout|holding retainage|retainage of \d+%)\b/i,
    reason: 'Delayed payment or retainage contingency introduced',
    severity: 'HIGH',
  },
  {
    category: 'WARRANTY_SUPPORT_CREEP',
    pattern: /\b(?:include (?:6 months?|1 year|free) (?:maintenance|warranty|support)|24\/7 on-?call|unlimited bug fixes forever|ongoing free updates)\b/i,
    reason: 'Extended free warranty or 24/7 support obligation slipped into terms',
    severity: 'HIGH',
  },
  {
    category: 'IP_EXCLUSIVE_GRAB',
    pattern: /\b(?:assign all moral rights|exclusive global patent waiver|unrestricted transfer of your pre-existing tools|waive all ownership)\b/i,
    reason: 'Aggressive intellectual property transfer or pre-existing tool seizure',
    severity: 'HIGH',
  },
  {
    category: 'SNEAKY_CONDITIONALITY',
    pattern: /\b(?:subject to (?:our board's|investor|further) approval|provided our internal team likes it|only if we achieve \d+%|at our sole discretion)\b/i,
    reason: 'Subjective acceptance contingency or unilateral discretion clause added',
    severity: 'MEDIUM',
  },
  {
    category: 'LIABILITY_SHIFT',
    pattern: /\b(?:unlimited indemnification|hold us harmless for any third party|consequential damages waiver removed)\b/i,
    reason: 'One-sided unlimited liability or indemnification clause added',
    severity: 'HIGH',
  },
];

/**
 * Evaluates semantic drift in incoming message relative to baseline summary
 */
export async function detectSemanticDrift(
  baselineSummary: string,
  incomingText: string
): Promise<SemanticDriftResult> {
  // 1. First, check if message is a clean confirmation without drift
  const isConfirmation = CONFIRMATION_PHRASES.some(re => re.test(incomingText));
  const hasDriftSignals = SEMANTIC_HEURISTICS.some(h => h.pattern.test(incomingText));

  if (isConfirmation && !hasDriftSignals) {
    return {
      detected: false,
      reason: 'Counterparty confirmed locked terms without alterations.',
      confidence: 0.95,
      severity: 'LOW',
    };
  }

  // 2. Check pluggable LLM if API key configured
  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const llmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();

  if (apiKey && (llmProvider === 'openai' || llmProvider === 'gemini')) {
    try {
      const llmResult = await queryLLMForDrift(llmProvider, apiKey, baselineSummary, incomingText);
      if (llmResult) return llmResult;
    } catch {
      // Fall through to deterministic heuristics on network/LLM error
    }
  }

  // 3. Fallback to deterministic heuristic semantic evaluation
  const detectedChanges: string[] = [];
  let highestSeverity: DriftSeverity = 'LOW';

  for (const h of SEMANTIC_HEURISTICS) {
    if (h.pattern.test(incomingText)) {
      detectedChanges.push(h.reason);
      if (h.severity === 'HIGH') {
        highestSeverity = 'HIGH';
      } else if (h.severity === 'MEDIUM' && highestSeverity !== 'HIGH') {
        highestSeverity = 'MEDIUM';
      }
    }
  }

  if (detectedChanges.length > 0) {
    return {
      detected: true,
      reason: detectedChanges.join('; '),
      confidence: 0.88,
      severity: highestSeverity,
      detectedChanges,
    };
  }

  return {
    detected: false,
    reason: 'No semantic commitment drift detected.',
    confidence: 0.9,
    severity: 'LOW',
  };
}

/**
 * Optional external LLM semantic evaluator
 */
async function queryLLMForDrift(
  provider: string,
  apiKey: string,
  baseline: string,
  incoming: string
): Promise<SemanticDriftResult | null> {
  const prompt = `You are a contract commitment drift auditor. Compare the baseline agreement with the new incoming proposal.
Baseline Agreement:
${baseline}

Incoming Message/Proposal:
${incoming}

Respond strictly in JSON format:
{
  "detected": true/false,
  "reason": "short explanation under 100 chars",
  "confidence": 0.0 to 1.0,
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "detectedChanges": ["change 1", "change 2"]
}`;

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (content) return JSON.parse(content);
  }

  return null;
}

import { CustomRule, RuleViolation } from '../types/index.js';

export function evaluateCustomRules(rules: CustomRule[] = [], text: string): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const lowerText = text.toLowerCase();

  for (const rule of rules) {
    let violated = false;
    let reason = '';

    // 1. Forbidden keywords check
    if (rule.forbiddenKeywords && rule.forbiddenKeywords.length > 0) {
      for (const kw of rule.forbiddenKeywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          violated = true;
          reason = `Message contains prohibited term: "${kw}" violating rule "${rule.name}"`;
          break;
        }
      }
    }

    // 2. Required keywords check (if message is a contract draft or formal counter)
    if (!violated && rule.requiredKeywords && rule.requiredKeywords.length > 0) {
      const isFormalOffer = /(?:contract|agreement|terms|offer|proposal|here is the draft)/i.test(text);
      if (isFormalOffer) {
        const missing = rule.requiredKeywords.filter(kw => !lowerText.includes(kw.toLowerCase()));
        if (missing.length > 0) {
          violated = true;
          reason = `Formal proposal omits required clause terms: ${missing.map(m => `"${m}"`).join(', ')}`;
        }
      }
    }

    // 3. Regex pattern match
    if (!violated && rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(text)) {
          violated = true;
          reason = `Matched violation pattern for rule: "${rule.name}"`;
        }
      } catch {
        // Ignore invalid regex in user-defined rule
      }
    }

    if (violated) {
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason,
        severity: rule.severity,
      });
    }
  }

  return violations;
}

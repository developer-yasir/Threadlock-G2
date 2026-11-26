import { EvaluationResult, ThreadLock } from '../types/index.js';

export class CounterOfferGenerator {
  /**
   * Generates a crisp, polite, firm counter-offer response
   */
  public async generateCounter(
    thread: ThreadLock,
    diff?: EvaluationResult,
    customNote?: string
  ): Promise<string> {
    // 1. Try LLM if configured
    const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    const provider = (process.env.LLM_PROVIDER || '').toLowerCase();

    if (apiKey && (provider === 'openai' || provider === 'gemini')) {
      try {
        const llmCounter = await this.queryLLM(thread, diff, customNote);
        if (llmCounter && llmCounter.trim().length > 10) {
          return llmCounter.trim();
        }
      } catch {
        // Fall through to deterministic template on any LLM error
      }
    }

    // 2. High-grade deterministic template synthesis
    return this.generateTemplateCounter(thread, diff, customNote);
  }

  private generateTemplateCounter(
    thread: ThreadLock,
    diff?: EvaluationResult,
    customNote?: string
  ): string {
    const locked = thread.lockedTerms;
    const lockedPrice = locked.price ? `$${locked.price.toLocaleString()} ${locked.currency || 'USD'}` : 'agreed rate';
    const lockedDeadline = locked.deadline || 'agreed deadline';

    if (customNote && customNote.trim().length > 0) {
      return `Thank you for the update. Regarding the terms for "${thread.title}": ${customNote.trim()} Our baseline remains aligned at ${lockedPrice} due ${lockedDeadline}. Please confirm if this works for you.`;
    }

    const priceDiff = diff?.structuredDiffs.find(d => d.field === 'price');
    const deadlineDiff = diff?.structuredDiffs.find(d => d.field === 'deadline');
    const scopeDiff = diff?.structuredDiffs.find(d => d.field === 'scope');

    // Case A: Price drift
    if (priceDiff) {
      const proposedVal = String(priceDiff.newValue);
      const isIncrease = priceDiff.driftType === 'PRICE_INCREASE';

      if (isIncrease) {
        return `Thank you for the update. Regarding the revised cost (${proposedVal}): our locked baseline commitment is ${lockedPrice} due ${lockedDeadline}. We could compromise midway, or retain the original ${lockedPrice} for the core scope. Please confirm which option you prefer.`;
      } else {
        return `We reviewed the proposed figure (${proposedVal}). As our baseline is locked at ${lockedPrice}, we can only accept a discount if non-critical deliverables are deferred to a subsequent milestone.`;
      }
    }

    // Case B: Deadline drift
    if (deadlineDiff) {
      const proposedDate = String(deadlineDiff.newValue);
      return `Thank you for the schedule update. Regarding the revised delivery (${proposedDate}): our baseline target is ${lockedDeadline}. We can accommodate a shorter adjustment to keep the launch on track. Let us align on an intermediate milestone check-in.`;
    }

    // Case C: Scope creep
    if (scopeDiff) {
      const newItem = String(scopeDiff.newValue);
      return `Thank you for clarifying the scope. Regarding the added deliverable ("${newItem}"): our locked baseline covers the agreed core deliverables. We can gladly add this item as a Phase 2 addendum, or swap out an equivalent item to keep the budget at ${lockedPrice}.`;
    }

    // Default clean negotiation counter
    return `Thank you for the update regarding "${thread.title}". To keep everything on schedule and aligned with our baseline (${lockedPrice}, due ${lockedDeadline}), let us proceed with the agreed terms or finalize an explicit addendum for changes.`;
  }

  private async queryLLM(
    thread: ThreadLock,
    diff?: EvaluationResult,
    customNote?: string
  ): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const prompt = `You are an expert contract negotiator acting via smart glasses.
Baseline Agreement:
- Title: ${thread.title}
- Price: ${thread.lockedTerms.price} ${thread.lockedTerms.currency}
- Deadline: ${thread.lockedTerms.deadline}
- Scope: ${thread.lockedTerms.scope?.join(', ')}

Counterparty's latest input/diff:
${diff ? JSON.stringify(diff.structuredDiffs) : 'General negotiation adjustment'}
${customNote ? `User specific guidance: ${customNote}` : ''}

Draft a crisp, courteous, firm 2-3 sentence counter-offer suitable for instant Telegram messaging. Output only the text of the reply.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || null;
  }
}

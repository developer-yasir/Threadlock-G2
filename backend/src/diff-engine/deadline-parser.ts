export interface ExtractedDeadline {
  isoDate: string; // YYYY-MM-DD
  rawText: string;
  isRelative: boolean;
  isRemoval?: boolean;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Extracts candidate deadlines or delivery dates from text
 */
export function extractDeadlines(text: string, referenceDate: Date = new Date('2026-11-26T00:00:00Z')): ExtractedDeadline[] {
  const results: ExtractedDeadline[] = [];

  // Check for explicit removal
  if (/(?:no deadline|remove deadline|without deadline|whenever ready|no rush|open-ended schedule)/i.test(text)) {
    results.push({
      isoDate: '',
      rawText: 'deadline removed',
      isRelative: false,
      isRemoval: true,
    });
    return results;
  }

  // 1. ISO format: 2026-11-30 or 2026/11/30
  const isoPattern = /\b(202[0-9])[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12][0-9]|3[01])\b/g;
  let match: RegExpExecArray | null;
  while ((match = isoPattern.exec(text)) !== null) {
    const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
    results.push({
      isoDate,
      rawText: match[0],
      isRelative: false,
    });
  }

  // 2. Month name formats: "Nov 30, 2026", "November 30", "30th of November 2026"
  const monthNamePattern = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+([0-9]{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(202[0-9]))?\b/gi;
  while ((match = monthNamePattern.exec(text)) !== null) {
    const monthStr = match[1].toLowerCase();
    const monthNum = MONTH_MAP[monthStr];
    const day = parseInt(match[2], 10);
    const year = match[3] ? parseInt(match[3], 10) : referenceDate.getFullYear();

    if (monthNum !== undefined && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, monthNum, day));
      const isoDate = d.toISOString().split('T')[0];
      if (!results.some(r => r.isoDate === isoDate)) {
        results.push({
          isoDate,
          rawText: match[0],
          isRelative: false,
        });
      }
    }
  }

  // 3. Reverse format: "30 Nov 2026", "15th December"
  const dayMonthPattern = /\b([0-9]{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s*,?\s*(202[0-9]))?\b/gi;
  while ((match = dayMonthPattern.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2].toLowerCase();
    const monthNum = MONTH_MAP[monthStr];
    const year = match[3] ? parseInt(match[3], 10) : referenceDate.getFullYear();

    if (monthNum !== undefined && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, monthNum, day));
      const isoDate = d.toISOString().split('T')[0];
      if (!results.some(r => r.isoDate === isoDate)) {
        results.push({
          isoDate,
          rawText: match[0],
          isRelative: false,
        });
      }
    }
  }

  // 4. Relative shifts: "in 2 weeks", "in 5 days", "in 1 month", "by next week"
  const relativePattern = /\b(?:in|by|within)\s+([0-9]+)\s+(day|days|week|weeks|month|months)\b/gi;
  while ((match = relativePattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const target = new Date(referenceDate);

    if (unit.startsWith('day')) {
      target.setUTCDate(target.getUTCDate() + num);
    } else if (unit.startsWith('week')) {
      target.setUTCDate(target.getUTCDate() + num * 7);
    } else if (unit.startsWith('month')) {
      target.setUTCMonth(target.getUTCMonth() + num);
    }

    const isoDate = target.toISOString().split('T')[0];
    results.push({
      isoDate,
      rawText: match[0],
      isRelative: true,
    });
  }

  return results;
}

/**
 * Calculates day difference between two ISO dates (dateB - dateA)
 */
export function getDaysDifference(dateA: string, dateB: string): number {
  const dA = new Date(dateA);
  const dB = new Date(dateB);
  const diffTime = dB.getTime() - dA.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

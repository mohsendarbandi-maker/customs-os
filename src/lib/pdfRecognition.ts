export type DocumentAnchor = { token: string; x: number; y: number; weight: number };
export type DocumentPageFeatures = {
  tokens: string[];
  anchors: DocumentAnchor[];
  numericShapes: string[];
  textLength: number;
};
export type RecognitionSample = {
  id: string;
  document_type: string;
  sample_name: string;
  source_filename: string;
  page_count: number;
  features: { version?: number; pages?: DocumentPageFeatures[] };
  created_at?: string;
};

const STOP_WORDS = new Set([
  'و', 'در', 'به', 'از', 'با', 'برای', 'این', 'آن', 'می', 'شود', 'شده', 'است', 'را',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'of', 'to', 'in', 'on',
  'شرکت', 'شماره', 'تاریخ', 'نام', 'آدرس', 'تلفن', 'کد', 'صفحه', 'نسخه', 'مهر',
]);

export function normalizeRecognitionText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .toLocaleLowerCase('fa')
    .replace(/[^\p{L}\p{N}./:-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokenize = (value: string) => normalizeRecognitionText(value)
  .split(' ')
  .map((token) => token.trim())
  .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  .slice(0, 500);

function numericShape(value: string): string[] {
  const digits = normalizeRecognitionText(value).match(/\d+/g) || [];
  return [...new Set(digits.map((digits) => digits.length >= 12 ? 'digits_12_plus' : 'digits_' + digits.length))].slice(0, 12);
}

export function buildDocumentPageFeatures(
  items: Array<{ str?: string; transform?: number[]; width?: number }>,
  pageWidth: number,
  pageHeight: number,
): DocumentPageFeatures {
  const words: DocumentAnchor[] = [];
  const allText: string[] = [];
  for (const item of items) {
    const text = typeof item.str === 'string' ? item.str : '';
    if (!text.trim()) continue;
    allText.push(text);
    const parts = tokenize(text);
    const transform = item.transform || [];
    const x = pageWidth > 0 && typeof transform[4] === 'number' ? Math.max(0, Math.min(1, transform[4] / pageWidth)) : 0.5;
    const y = pageHeight > 0 && typeof transform[5] === 'number' ? Math.max(0, Math.min(1, 1 - transform[5] / pageHeight)) : 0.5;
    for (const token of parts) words.push({ token, x, y, weight: Math.min(3, 1 + Math.log2(Math.max(1, parts.length))) });
  }
  const counts = new Map<string, number>();
  words.forEach((word) => counts.set(word.token, (counts.get(word.token) || 0) + 1));
  const tokens = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([token]) => token);
  const anchors = words
    .filter((word) => tokens.includes(word.token))
    .slice(0, 100);
  const text = allText.join(' ');
  return { tokens, anchors, numericShapes: numericShape(text), textLength: text.length };
}

export function buildDocumentPageFeaturesFromText(
  text: string,
  words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }>,
  pageWidth = 1,
  pageHeight = 1,
): DocumentPageFeatures {
  const tokens = [...new Set(tokenize(text))].slice(0, 80);
  const anchors: DocumentAnchor[] = [];
  for (const word of words || []) {
    const wordTokens = tokenize(word.text || '');
    const box = word.bbox;
    for (const token of wordTokens) {
      if (!tokens.includes(token)) continue;
      anchors.push({
        token,
        x: box ? Math.max(0, Math.min(1, ((box.x0 + box.x1) / 2) / Math.max(1, pageWidth))) : 0.5,
        y: box ? Math.max(0, Math.min(1, ((box.y0 + box.y1) / 2) / Math.max(1, pageHeight))) : 0.5,
        weight: Math.max(0.5, Math.min(3, (word.confidence || 70) / 35)),
      });
    }
  }
  return { tokens, anchors: anchors.slice(0, 100), numericShapes: numericShape(text), textLength: text.length };
}

function pageSimilarity(candidate: DocumentPageFeatures, sample: DocumentPageFeatures): number {
  const left = new Set(candidate.tokens || []);
  const right = new Set(sample.tokens || []);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const tokenScore = intersection / Math.max(1, Math.min(left.size, right.size));
  const sampleAnchors = (sample.anchors || []).filter((anchor) => left.has(anchor.token));
  const candidateAnchors = candidate.anchors || [];
  let layoutScore = 0;
  let layoutMatches = 0;
  for (const expected of sampleAnchors.slice(0, 30)) {
    const actual = candidateAnchors.find((anchor) => anchor.token === expected.token);
    if (!actual) continue;
    const distance = Math.hypot(actual.x - expected.x, actual.y - expected.y);
    layoutScore += Math.max(0, 1 - distance / 0.45);
    layoutMatches += 1;
  }
  layoutScore = layoutMatches ? layoutScore / layoutMatches : 0;
  const numberOverlap = (candidate.numericShapes || []).filter((shape) => (sample.numericShapes || []).includes(shape)).length;
  const numberScore = numberOverlap / Math.max(1, (sample.numericShapes || []).length);
  return Math.max(0, Math.min(1, tokenScore * 0.62 + layoutScore * 0.28 + numberScore * 0.1));
}

export function scoreRecognitionSample(candidate: DocumentPageFeatures, sample: RecognitionSample): number {
  const samplePages = sample.features?.pages || [];
  if (!samplePages.length) return 0;
  const scores = samplePages.map((page) => pageSimilarity(candidate, page)).sort((a, b) => b - a);
  const best = scores[0] || 0;
  const second = scores[1] || 0;
  return Math.max(0, Math.min(1, best * 0.75 + second * 0.25));
}

export function recognizeDocumentPage(
  candidate: DocumentPageFeatures,
  samples: RecognitionSample[],
): { documentType: string; confidence: number; sampleId: string } | null {
  const ranked = samples
    .map((sample) => ({ sample, confidence: scoreRecognitionSample(candidate, sample) }))
    .sort((a, b) => b.confidence - a.confidence);
  const winner = ranked[0];
  if (!winner || winner.confidence < 0.2) return null;
  return { documentType: winner.sample.document_type, confidence: winner.confidence, sampleId: winner.sample.id };
}

export function estimateJpegBytesFromSamples(samples: Array<{ bytes: number; area: number }>, pageAreas: number[], fallbackBytes: number): {
  low: number; expected: number; high: number; sampledPages: number;
} {
  const valid = samples.filter((sample) => sample.bytes > 0 && sample.area > 0);
  const ratios = valid.map((sample) => sample.bytes / sample.area).sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;
  const estimate = pageAreas.reduce((sum, area) => sum + area * median, 0);
  const expected = Math.max(fallbackBytes, estimate);
  return {
    low: Math.round(expected * 0.78),
    expected: Math.round(expected),
    high: Math.round(expected * 1.28),
    sampledPages: valid.length,
  };
}

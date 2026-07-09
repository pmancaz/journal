export type WordFrequency = {
  word: string
  count: number
}

const STOP_WORDS = new Set([
  'the', 'and', 'but', 'with', 'this', 'from', 'that', 'have', 'has', 'had',
  'was', 'were', 'are', 'been', 'being', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'not', 'also', 'just', 'into', 'its',
  'for', 'you', 'your', 'all', 'more', 'some', 'when', 'then', 'than',
  'they', 'their', 'them', 'what', 'which', 'there', 'here', 'how', 'where',
  'who', 'why', 'our', 'out', 'one', 'two', 'about', 'after', 'before',
  'over', 'even', 'back', 'only', 'like', 'such', 'very', 'well', 'still',
  'much', 'many', 'each', 'most', 'other', 'these', 'those', 'both', 'few',
  'any', 'own', 'same', 'every', 'too', 'now', 'new', 'way', 'did',
  'get', 'got', 'make', 'made', 'take', 'took', 'come', 'came', 'know',
  'think', 'see', 'look', 'want', 'use', 'good', 'first', 'last',
  // weekdays
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // months
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
])

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export function getFrequentWords(
  text: string,
  options: { topN?: number } = {}
): WordFrequency[] {
  const { topN = 30 } = options

  const cleaned = text
    .replace(/[^\w\s'-]/g, ' ')
    .toLowerCase()

  const freq = new Map<string, number>()

  const tokens = cleaned.split(/[\s\W]+/)
  for (const token of tokens) {
    if (token.length < 3) continue
    if (/^\d+$/.test(token)) continue
    if (STOP_WORDS.has(token)) continue
    freq.set(token, (freq.get(token) ?? 0) + 1)
  }

  return Array.from(freq.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
}

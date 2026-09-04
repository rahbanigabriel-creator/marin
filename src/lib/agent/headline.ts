/**
 * Keep a card-backed chat lead concise without treating decimal points or URL
 * dots as sentence boundaries.
 */
export function leadHeadline(text: string, maxChars = 360): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;

  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index++) {
    if (!".!?".includes(normalized[index])) continue;

    let end = index + 1;
    while (end < normalized.length && ".!?".includes(normalized[end])) end++;
    while (end < normalized.length && /[\"')\]}]/.test(normalized[end])) end++;
    if (end < normalized.length && !/\s/.test(normalized[end])) continue;

    const sentence = normalized.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    while (end < normalized.length && /\s/.test(normalized[end])) end++;
    start = end;
    index = end - 1;
  }

  let headline = "";
  for (const sentence of sentences) {
    const next = headline ? `${headline} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    headline = next;
  }
  if (headline) return headline;

  const cut = normalized.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

export function makeListingFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 3)
    .slice(0, 8)
    .join(' ');
}

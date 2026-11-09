export type TcgDexImageIdentity = {
  locale: 'en' | 'ja';
  localId?: string;
  setId?: string;
  eraId?: string;
  sourceCardId?: string;
  image?: string;
};

function cleanSegment(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanLocalId(value: string | undefined): string | undefined {
  return cleanSegment(value)?.split('/')[0]?.trim() || undefined;
}

function comparableLocalId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
}

function withHighResolutionSuffix(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/high.png') ? trimmed : `${trimmed}/high.png`;
}

function tcgDexIdentityFromSourceCardId(sourceCardId: string | undefined, localId: string | undefined): { setId?: string; localId?: string } {
  const source = cleanSegment(sourceCardId);
  const local = cleanLocalId(localId);
  if (!source) return { localId: local };
  if (local && source.toLowerCase().endsWith(`-${local.toLowerCase()}`)) {
    return { setId: source.slice(0, -(local.length + 1)), localId: local };
  }
  const match = /^(.*)-([^-]+)$/.exec(source);
  return { setId: match?.[1], localId: local ?? match?.[2] };
}

function inferredTcgDexEra(setId: string | undefined): string | undefined {
  const knownEra = /^(SWSH|HGSS|SV|SM|XY|BW|DP|S)(?=\d|P|-|$)/i.exec(setId ?? '')?.[1];
  return (knownEra ?? /^([a-z]+)/i.exec(setId ?? '')?.[1])?.toUpperCase();
}

export function isAbsoluteHttpImageUrl(value: string | undefined): boolean {
  if (!value || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !!parsed.hostname
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export function isIdentifiableGenericCardImageUrl(value: string | undefined): boolean {
  if (!isAbsoluteHttpImageUrl(value)) return false;
  const parsed = new URL(value!);
  const identity = decodeURIComponent(`${parsed.hostname}${parsed.pathname}`).toLowerCase();
  return /(?:^|[\/_\-.])(card[_-]?back|back[_-]?of[_-]?card|pokemon[_-]?card[_-]?back|tcg[_-]?back|placeholder|default[_-]?card|image[_-]?unavailable)(?:[\/_\-.]|$)/i.test(identity);
}

const KNOWN_GENERIC_CARD_BACK_URLS = new Set([
  'https://images.pokemontcg.io/me55/139_hires.png',
  'https://images.pokemontcg.io/me55/153_hires.png'
]);

export function isStructurallyValidTcgDexImageUrl(value: string | undefined, expectedLocalId?: string): boolean {
  if (!isAbsoluteHttpImageUrl(value)) return false;
  const parsed = new URL(value!);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'assets.tcgdex.net') return false;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts.at(-1) !== 'high.png') return false;
  const cardId = decodeURIComponent(parts.at(-2) ?? '');
  const expected = cleanLocalId(expectedLocalId);
  return !!cardId && (!expected || comparableLocalId(cardId) === comparableLocalId(expected));
}

export function tcgDexCanonicalImageUrl(identity: TcgDexImageIdentity): string | undefined {
  const fromSource = tcgDexIdentityFromSourceCardId(identity.sourceCardId, identity.localId);
  const localId = cleanLocalId(identity.localId) ?? fromSource.localId;
  const setId = cleanSegment(identity.setId) ?? fromSource.setId;
  const supplied = cleanSegment(identity.image);
  if (supplied) {
    const candidate = withHighResolutionSuffix(supplied);
    if (isStructurallyValidTcgDexImageUrl(candidate, localId)) return candidate;
  }
  const eraId = cleanSegment(identity.eraId) ?? inferredTcgDexEra(setId);
  if (!localId || !setId || !eraId) return undefined;
  return `https://assets.tcgdex.net/${identity.locale}/${encodeURIComponent(eraId)}/${encodeURIComponent(setId)}/${encodeURIComponent(localId)}/high.png`;
}

export function isStructurallyValidTrustedCardImageUrl(value: string | undefined, sourceName?: string, expectedLocalId?: string): boolean {
  if (!isAbsoluteHttpImageUrl(value)) return false;
  if (KNOWN_GENERIC_CARD_BACK_URLS.has(value!)) return false;
  if (isIdentifiableGenericCardImageUrl(value)) return false;
  const parsed = new URL(value!);
  if (parsed.hostname === 'assets.tcgdex.net' || /^TCGdex(?: Japanese)?(?:\s*\(|$)/i.test(sourceName ?? '')) {
    return isStructurallyValidTcgDexImageUrl(value, expectedLocalId);
  }
  return true;
}

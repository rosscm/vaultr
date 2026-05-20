import fs from 'node:fs';
import path from 'node:path';
import type { Chase, Listing } from '../types.js';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function defaultListings(): Listing[] {
  return [
    {
      source: 'EBAY',
      listingId: 'mock-1',
      title: 'Squirtle PSA 10 Base Set',
      price: 95,
      currency: 'USD',
      shippingCost: 4,
      shippingCurrency: 'USD',
      url: 'https://example.com/mock-1',
      seller: 'mock_seller',
      sellerFeedbackPercent: 99.7,
      sellerFeedbackScore: 1542,
      postedAt: new Date().toISOString(),
      region: 'US',
      condition: 'Near Mint'
    },
    {
      source: 'EBAY',
      listingId: 'mock-2',
      title: 'Umbreon VMAX Alt Art PSA 10',
      price: 1140,
      currency: 'CAD',
      shippingCost: 15,
      shippingCurrency: 'CAD',
      url: 'https://example.com/mock-2',
      seller: 'mock_seller_ca',
      sellerFeedbackPercent: 100,
      sellerFeedbackScore: 892,
      postedAt: new Date().toISOString(),
      region: 'CA',
      condition: 'Near Mint'
    }
  ];
}

export function loadMockListings(): Listing[] {
  const customPath = process.env.MOCK_LISTINGS_PATH;
  if (!customPath) return defaultListings();

  try {
    const raw = fs.readFileSync(path.resolve(customPath), 'utf8');
    const parsed = JSON.parse(raw) as Listing[];
    return Array.isArray(parsed) ? parsed : defaultListings();
  } catch {
    return defaultListings();
  }
}

export function searchMockListings(chase: Chase): Listing[] {
  const card = normalize(chase.cardName);
  return loadMockListings().filter((listing) => normalize(listing.title).includes(card));
}

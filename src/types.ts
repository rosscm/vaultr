export type Chase = {
  id: string;
  userId: string;
  guildId?: string;
  cardName: string;
  maxPrice?: number;
  grade?: string;
  condition?: string;
  region?: 'CA' | 'US' | 'ANY';
  createdAt: string;
};

export type Listing = {
  source: 'EBAY';
  listingId: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  seller?: string;
  sellerFeedbackPercent?: number;
  postedAt?: string;
  region: 'CA' | 'US' | 'OTHER';
  condition?: string;
};

export type MatchResult = {
  isMatch: boolean;
  score: number;
  reasons: string[];
};

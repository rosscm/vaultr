export type Chase = {
  id: string;
  userId: string;
  guildId?: string;
  cardName: string;
  maxPrice?: number;
  grade?: string;
  condition?: string;
  region?: 'CA' | 'US' | 'ANY';
  negativeKeywords?: string[];
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

export type PlanTier = 'FREE' | 'PRO';

export type UserPlan = {
  userId: string;
  tier: PlanTier;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  updatedAt: string;
};

export type UserAlertSettings = {
  userId: string;
  minScore: number;
  maxAlertsPerHour: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  updatedAt: string;
};

export type SentAlert = {
  chaseId: string;
  userId: string;
  listingId: string;
  source: 'EBAY';
  sentAt: string;
  listingTitle?: string;
  listingPrice?: number;
  listingCurrency?: string;
  listingUrl?: string;
  matchScore?: number;
};

export type ListingSource = 'EBAY' | 'SHOPIFY';
export type ListingSourceModePreference = 'EBAY' | 'EBAY_SHOPIFY' | 'SHOPIFY';

export type Chase = {
  id: string;
  userId: string;
  guildId?: string;
  cardName: string;
  cardImageUrl?: string;
  cardImageIdentity?: string;
  cardImageSourceName?: string;
  cardImageSourceKind?: 'CARD_REFERENCE' | 'MARKET_LISTING';
  cardImageSourceCardId?: string;
  queryName?: string;
  priority?: 'GRAIL' | 'HIGH' | 'NORMAL';
  targetNote?: string;
  maxPrice?: number;
  grade?: string;
  condition?: string;
  listingType?: 'ANY' | 'AUCTION' | 'BUY_IT_NOW';
  negativeKeywords?: string[];
  createdAt: string;
  tasteWeight?: number;
  tasteSource?: 'ACTIVE_CHASE' | 'REMOVED_CHASE' | 'GOOD_ALERT' | 'BOUGHT_OR_SEEN' | 'DISCOVERY_ADD' | 'DISCOVERY_LIKE';
};

export type Listing = {
  source: ListingSource;
  listingId: string;
  title: string;
  detailsText?: string;
  price: number;
  currency: string;
  shippingCost?: number;
  shippingCurrency?: string;
  shippingDestinationCountry?: string;
  shippingDestinationPostalCode?: string;
  shippingEligibility?: 'AVAILABLE' | 'MAY_NOT_SHIP' | 'UNKNOWN';
  shippingEligibilityMessage?: string;
  url: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  seller?: string;
  sellerFeedbackPercent?: number;
  sellerFeedbackScore?: number;
  postedAt?: string;
  region: 'CA' | 'US' | 'OTHER';
  condition?: string;
  listingType?: 'AUCTION' | 'BUY_IT_NOW' | 'OTHER';
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
  alertCurrency: 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY';
  shippingCountry?: string;
  shippingPostalCode?: string;
  listingSourceMode: ListingSourceModePreference;
  updatedAt: string;
};

export type SentAlert = {
  chaseId: string;
  chaseName?: string;
  userId: string;
  listingId: string;
  source: ListingSource;
  sentAt: string;
  listingTitle?: string;
  listingPrice?: number;
  listingCurrency?: string;
  listingUrl?: string;
  matchScore?: number;
  listingPostedAt?: string;
  alertLatencySeconds?: number;
  sourceFirstSeenAt?: string;
  sourceLastSeenAt?: string;
  sourceRank?: number;
};

export type AlertDeliveryChannel = 'DISCORD_DM';
export type AlertDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED';

export type AlertEvent = {
  id: string;
  userId: string;
  chaseId: string;
  guildId?: string;
  listingId: string;
  source: ListingSource;
  status: 'MATCHED' | 'DELIVERY_PENDING' | 'DELIVERED' | 'DELIVERY_FAILED';
  chaseName?: string;
  chasePriority?: Chase['priority'];
  listingTitle?: string;
  listingPrice?: number;
  listingCurrency?: string;
  priceDelta?: number;
  listingUrl?: string;
  matchScore?: number;
  listingPostedAt?: string;
  alertLatencySeconds?: number;
  sourceFirstSeenAt?: string;
  sourceLastSeenAt?: string;
  sourceRank?: number;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AlertDelivery = {
  id: string;
  alertId: string;
  userId: string;
  channel: AlertDeliveryChannel;
  status: AlertDeliveryStatus;
  attempts: number;
  externalMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type AlertHistoryCursor = {
  createdAt: string;
  id: string;
};

export type AlertHistoryItem = {
  id: string;
  chaseId: string;
  chaseName?: string;
  chasePriority?: Chase['priority'];
  listingId: string;
  source: ListingSource;
  listingTitle?: string;
  listingPrice?: number;
  listingCurrency?: string;
  priceDelta?: number;
  listingUrl?: string;
  matchScore?: number;
  listingPostedAt?: string;
  alertLatencySeconds?: number;
  createdAt: string;
  updatedAt: string;
};

export type AlertHistoryPage = {
  items: AlertHistoryItem[];
  nextCursor?: AlertHistoryCursor;
};

export type Chase = {
  id: string;
  userId: string;
  cardName: string;
  maxPrice?: number;
  grade?: string;
  condition?: string;
  region?: 'CA' | 'US' | 'ANY';
  createdAt: string;
};

export type OrderBookQueryData = {
  market?: {
    orderBook?: Array<{ min: number; max: number; value: number }>;
  };
};

export type EstimateMinPriceQueryData = {
  market?: {
    estimateMinPrice?: number | null;
  };
};

export type ExtendableDelegatesQueryData = {
  market?: {
    extendableDelegates?: unknown;
  };
};

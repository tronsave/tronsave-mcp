export type OrderSellManualMutationData = {
  orders?: {
    sell?: {
      code: number;
      success: boolean;
      message: string;
      delegatedId?: string | null;
    };
  };
};

export type OrderCancelMutationData = {
  orders?: {
    cancel?: {
      code: number;
      success: boolean;
      message: string;
    };
  };
};

export type OrderUpdateMutationData = {
  orders?: {
    update?: {
      code: number;
      success: boolean;
      message: string;
    };
  };
};

type OrderParty = {
  address: string;
};

type OrderCompact = {
  id: string;
  requester?: OrderParty | null;
  receiver: OrderParty;
  resourceType: "ENERGY" | "BANDWIDTH";
  resourceAmount: number;
  remainAmount: number;
  durationSec: number;
  isOwner: boolean;
  isMatching: boolean;
  apy: number;
  unitPrice: number;
  createdAt: number;
  typeOrder: "NORMAL" | "FAST" | "EXTEND";
};

export type OrderDetailQueryData = {
  order?: OrderCompact | null;
};

export type OrdersListQueryData = {
  orders?: OrderCompact[] | null;
};

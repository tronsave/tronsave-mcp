const ORDER_FIELDS = `
id
requester { address }
receiver { address }
resourceType
resourceAmount
remainAmount
durationSec
isOwner
isMatching
apy
unitPrice
createdAt
typeOrder
`;

export const ORDER_DETAIL_QUERY = `
query OrderDetail($id: MObjectId) {
  order(id: $id) {
    ... on NormalOrder {
      ${ORDER_FIELDS}
    }
    ... on FastOrder {
      ${ORDER_FIELDS}
    }
    ... on ExtendOrder {
      ${ORDER_FIELDS}
    }
  }
}
`;

export const ORDERS_LIST_QUERY = `
query OrdersList(
  $offset: Int
  $limit: Int
  $isFulfilled: EOrderFulfillStatus
  $resourceType: EResourceType
  $sortFilterBy: [OrderSortInput]
  $myAddress: TronAddress
  $isOwner: Boolean
  $isMatching: Boolean
  $receivers: [TronAddress]
  $fromId: String
) {
  orders(
    offset: $offset
    limit: $limit
    isFulfilled: $isFulfilled
    resourceType: $resourceType
    sortFilterBy: $sortFilterBy
    myAddress: $myAddress
    isOwner: $isOwner
    isMatching: $isMatching
    receivers: $receivers
    fromId: $fromId
  ) {
    ... on NormalOrder {
      ${ORDER_FIELDS}
    }
    ... on FastOrder {
      ${ORDER_FIELDS}
    }
    ... on ExtendOrder {
      ${ORDER_FIELDS}
    }
  }
}
`;

export const ORDER_CREATE_MUTATION = `
mutation OrderCreate(
  $orderInfo: OrderInfoInput!
  $paymentMethod: PaymentMethodInput!
  $options: OrderOptionsInput
  $useCoupon: String
  $smartMatching: SmartMatchingInput
) {
  orders {
    create(
      orderInfo: $orderInfo
      paymentMethod: $paymentMethod
      options: $options
      useCoupon: $useCoupon
      smartMatching: $smartMatching
    ) {
      code
      success
      message
      data {
        orderId
      }
    }
  }
}
`;

export const ORDER_SELL_MANUAL_MUTATION = `
mutation OrderSellManual($sellManualInput: OrderSellManualInput!) {
  orders {
    sell(sellManualInput: $sellManualInput) {
      code
      success
      message
      delegatedId
    }
  }
}
`;

export const ORDER_CANCEL_MUTATION = `
mutation OrderCancel($orderId: MObjectId!) {
  orders {
    cancel(orderId: $orderId) {
      code
      success
      message
    }
  }
}
`;

export const ORDER_UPDATE_MUTATION = `
mutation OrderUpdate($orderId: MObjectId!, $receiver: TronAddress, $newPrice: Float) {
  orders {
    update(orderId: $orderId, receiver: $receiver, newPrice: $newPrice) {
      code
      success
      message
    }
  }
}
`;

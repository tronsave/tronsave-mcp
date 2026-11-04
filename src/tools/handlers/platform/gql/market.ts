export const GET_SYSTEM_DEPOSIT_ADDRESS_QUERY = `
query GetSystemDepositAddress {
  system {
    systemDepositAddress
  }
}
`;

export const ORDER_BOOK_QUERY = `
query OrderBook(
  $address: TronAddress
  $resourceType: EResourceType!
  $minDelegateAmount: Float
  $durationSec: Float
) {
  market {
    orderBook(
      address: $address
      resourceType: $resourceType
      minDelegateAmount: $minDelegateAmount
      durationSec: $durationSec
    ) {
      min
      max
      value
    }
  }
}
`;

export const GET_MIN_PRICE_QUERY = `
query EstimateMinPrice(
  $address: TronAddress
  $resourceType: EResourceType!
  $buyAmount: Float!
  $durationSec: Float!
) {
  market {
    estimateMinPrice(
      address: $address
      resourceType: $resourceType
      buyAmount: $buyAmount
      durationSec: $durationSec
    )
  }
}
`;

export const EXTENDABLE_DELEGATES_QUERY = `
query ExtendableDelegates(
  $requester: String
  $receiver: TronAddress!
  $resourceType: EResourceType!
  $suggestData: ExtendAndBuySuggestInput
) {
  market {
    extendableDelegates(
      requester: $requester
      receiver: $receiver
      resourceType: $resourceType
      suggestData: $suggestData
    ) {
      maxExtendAmount
      minExtendRequired
      totalAvailableExtraBuyAmount
      overBuyAmount
      overBuyPrice
      overBuyAmountAvailable
      overBuyAmountMaxAvailable
      data {
        amount
        isExtendable
        extendPrice
        reclaimTime
        minTimeExtendTo
        availableExtendAt
        reason
        availableResource
      }
    }
  }
}
`;

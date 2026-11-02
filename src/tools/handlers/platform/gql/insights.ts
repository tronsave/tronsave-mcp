export const MARKET_OVERVIEW_QUERY = `
query MarketOverview {
  market {
    resources {
      totalAvailableEnergy
      totalAvailableBandwidth
      totalLimitEnergy
      totalLimitBandwidth
    }
    totalPool
    energyApy: apy(resourceType: ENERGY)
    bandwidthApy: apy(resourceType: BANDWIDTH)
  }
}
`;

export const PRICE_TABLE_QUERY = `
query ResourcePriceTable($address: TronAddress, $resourceType: EResourceType!) {
  market {
    resourcePriceTable(address: $address, resourceType: $resourceType) {
      durations
      amounts
      prices
    }
  }
}
`;

export const SYSTEM_INFO_QUERY = `
query SystemInfo {
  system {
    lastBlock { number timestamp }
    systemDepositAddress
    maxDelegateLockPeriod
    minBuyEnergyAmount
    minBuyBandwidthAmount
    burningEnergyRate
    burningBandwidthRate
    dynamicBuyEnergyPrice
    dynamicLowestEnergyPrice
    dynamicBuyBandwidthPrice
    dynamicLowestBandwidthPrice
    freezeEnergyRate
    freezeBandwidthRate
    maxProfitShare
    usdtTransferEnergyValue { value rawValue }
  }
}
`;

export const ACCOUNT_RESOURCES_QUERY = `
query AccountResources($address: TronAddress) {
  user(address: $address) {
    address
    balance
    resourcesV2 {
      energyDelegatable
      energyStakeLimit
      energyUnFreezable
      energyRecoverRate
      bandwidthDelegatable
      bandwidthStakeLimit
      bandwidthUnFreezable
      bandwidthRecoverRate
    }
  }
}
`;

export const SUGGEST_CREATE_ORDER_QUERY = `
query SuggestCreateOrder($requester: String, $orderInfo: OrderInfoInput!, $options: OrderOptionsInput) {
  market {
    suggestCreateOrder(requester: $requester, orderInfo: $orderInfo, options: $options) {
      suggestCreateType
      readyToFill
      payout
      extendData { delegator isExtend extraAmount extendTo }
      details {
        totalPayout
        extendAmount
        extraBuyAmount
        newBuyAmount
      }
    }
  }
}
`;

export const EXTENDABLE_RECEIVERS_QUERY = `
query ExtendableReceivers($requester: TronAddress!, $resourceType: EResourceType) {
  market {
    extendableReceivers(requester: $requester, resourceType: $resourceType) {
      address
      expiredAt
      resourceType
      delegateCount
      totalAmount
    }
  }
}
`;

export const SELLER_STATS_QUERY = `
query SellerStats($resourceType: EResourceType!, $timeFilterBy: ETimeUnitStats) {
  user {
    stats {
      delegatedCount
      delegatedCountForEnergy
      delegatedCountForBandwidth
      totalResourceDelegatedForEnergy
      totalResourceDelegatedForBandwidth
      totalTrxEarn
      totalTrxEarnForEnergy
      totalTrxEarnForBandwidth
      avgPriceDelegatedForEnergy
      avgPriceDelegatedForBandwidth
      lastUpdatedAt
    }
    chartSellers(resourceType: $resourceType, timeFilterBy: $timeFilterBy) {
      date
      totalTrxEarn
      autoDelegateResourceAmount
      manualDelegateResourceAmount
      exclusiveDelegateResourceAmount
      extendDelegateResourceAmount
    }
  }
}
`;

export const DELEGATIONS_QUERY = `
query Delegations(
  $offset: Int
  $limit: Int
  $timeFilterBy: ETimeFilter
  $filterByTypeDelegate: EDelegateType
  $filterByResourceType: EResourceType
) {
  user {
    delegates(
      offset: $offset
      limit: $limit
      timeFilterBy: $timeFilterBy
      filterByTypeDelegate: $filterByTypeDelegate
      filterByResourceType: $filterByResourceType
    ) {
      id
      resourceType
      resourceAmount
      trxAmount
      durationSec
      unitPrice
      typeDelegate
      status
      delegateAt
      paidAmount
      paidAt
    }
  }
}
`;

export const AUTO_BUY_SETTINGS_QUERY = `
query AutoBuySettings($offset: Int, $limit: Int, $filterBy: [EAutoBuySettingFilter]) {
  user {
    autoBuySettings(offset: $offset, limit: $limit, filterBy: $filterBy) {
      id
      requester
      receiver
      isEnergy
      resourceAmount
      durationSec
      unitPrice
      isActive
      thresholdResourceAmount
      limitBudgetInSun
      limitInOrderCount
      totalBoughtInSun
      totalBoughtInOrderCount
      startActiveAt
      endActiveAt
      createdAt
      updatedAt
    }
  }
}
`;

export const CREATE_AUTO_BUY_SETTING_MUTATION = `
mutation CreateAutoBuySetting($buyInfo: AutoBuyInfoInput!, $options: AutoBuyOptionInput!) {
  users {
    createAutoBuySetting(buyInfo: $buyInfo, options: $options) {
      code
      success
      message
    }
  }
}
`;

export const UPDATE_AUTO_BUY_SETTING_MUTATION = `
mutation UpdateAutoBuySetting($id: MObjectId!, $isActive: Boolean, $buyInfo: AutoBuyInfoInput, $options: AutoBuyOptionInput) {
  users {
    updateAutoBuySetting(id: $id, isActive: $isActive, buyInfo: $buyInfo, options: $options) {
      code
      success
      message
      data { id isActive unitPrice resourceAmount thresholdResourceAmount }
    }
  }
}
`;

export const NOTIFICATIONS_QUERY = `
query Notifications($offset: Int, $limit: Int, $unreadOnly: Boolean) {
  user {
    notifications(offset: $offset, limit: $limit, unreadOnly: $unreadOnly) {
      total
      data { id kind event type params isRead createdAt }
    }
    unreadNotificationCount { count }
  }
}
`;

export const MARK_NOTIFICATION_READ_MUTATION = `
mutation MarkNotificationRead($id: MObjectId!) {
  users { markNotificationRead(id: $id) { code success message modifiedCount } }
}
`;

export const MARK_ALL_NOTIFICATIONS_READ_MUTATION = `
mutation MarkAllNotificationsRead {
  users { markAllNotificationsRead { code success message modifiedCount } }
}
`;

export const REFERRAL_QUERY = `
query Referral($offset: Int, $limit: Int, $filterBy: EReferralStatus) {
  user {
    info {
      userRefCode
      sponsor
      pendingRefCode
      totalRef
      totalPendingRef
      totalRefBonus
      remainRefBonus
      rank
      referralList(offset: $offset, limit: $limit, filterBy: $filterBy) { id address status }
      refCommissionHistory(offset: $offset, limit: $limit) { netAmount botAmount normalAmount txid createdAt }
    }
  }
}
`;

export const TELEGRAM_NOTIFY_QUERY = `
query TelegramNotify {
  user {
    telegramNotifySetting {
      telegramId
      sellerFilter {
        isEnabled
        onlySendUnlockOrders
        remainAmount { isEnabled from to }
        duration { isEnabled from to }
        price { isEnabled from to }
        apy { isEnabled from to }
      }
      buyerFilter {
        isEnabled
        reclaimAlertTime { isEnabled value }
        lowResourceAlertEnergy { isEnabled value }
        lowResourceAlertBandwidth { isEnabled value }
      }
    }
  }
}
`;

export const UPDATE_TELEGRAM_NOTIFY_MUTATION = `
mutation UpdateTelegramNotify($data: UpdateTelegramNotifySettingInput!) {
  users { updateTelegramNotifySetting(data: $data) { code success message } }
}
`;

export const AGENCY_BOT_QUERY = `
query AgencyBot($timeFilterBy: ETimeFilter) {
  user {
    botAgency {
      botId
      displayName
      botUsername
      address
      status
      reason
      lastOrderAt
      reward { totalRewards unpaidRewards }
      statistics(timeFilterBy: $timeFilterBy) {
        totalEnergyOrders
        totalBandwidthOrders
        totalEnergyResourceSell
        totalBandwidthResourceSell
      }
    }
  }
}
`;

export const INTERNAL_TXS_QUERY = `
query InternalTxs($offset: Int, $limit: Int) {
  user {
    internalAcc {
      balance
      depositAddress
      internalTxs(offset: $offset, limit: $limit) { id info { type amount createdAt } }
    }
  }
}
`;

export const FLASH_UNSTAKE_REQUEST_QUERY = `
query MyFlashUnstakeRequest {
  user {
    flashUnstakeRequest {
      id
      receiver
      state
      payoutState
      unstakeAmount
      extraFee
      payoutAmount
      netReceiveAmount
      estimateCompletionTime
      amountReleased
      createdAt
      confirmedAt
    }
  }
}
`;

export const FLASH_UNSTAKE_ORDERS_PUBLIC_QUERY = `
query FlashUnstakePublic($offset: Int, $limit: Int) {
  flashUnstake { publicOrders(offset: $offset, limit: $limit) { id createdAt unstakeAmount payoutAmount netReceiveAmount estimateCompletionTime } }
}
`;
export const FLASH_UNSTAKE_ORDERS_COMPLETE_QUERY = `
query FlashUnstakeComplete($offset: Int, $limit: Int) {
  flashUnstake { completeOrders(offset: $offset, limit: $limit) { id createdAt unstakeAmount payoutAmount netReceiveAmount estimateCompletionTime } }
}
`;
export const FLASH_UNSTAKE_ORDERS_ONGOING_QUERY = `
query FlashUnstakeOngoing($offset: Int, $limit: Int) {
  flashUnstake { ongoingOrders(offset: $offset, limit: $limit) { id createdAt unstakeAmount payoutAmount netReceiveAmount estimateCompletionTime amountReleased nextPayoutAmount nextPayoutAt } }
}
`;

export const ESTIMATE_FLASH_UNSTAKE_QUERY = `
query EstimateFlashUnstake($requester: TronAddress!) {
  market {
    estimateFlashUnstakePayout(requester: $requester) {
      totalStakedAmount
      feePercentage
      extraFee
      delegateCount
      payoutAmount
      isOwnerPermissionTransfer
      isValidMinUnstakeAmount
      minUnstakeAmount
    }
  }
}
`;

export const BULK_CREATE_INTERNAL_MUTATION = `
mutation BulkCreateInternal(
  $orderInfo: OrderBulkCreateInternalInfoInput!
  $paymentMethod: OrderBulkCreateInternalPaymentMethodInput!
) {
  orders {
    bulkCreateInternal(orderInfo: $orderInfo, paymentMethod: $paymentMethod) {
      code
      success
      message
      data
    }
  }
}
`;

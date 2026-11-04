export const REGISTER_AUTO_SELL_MUTATION = `
mutation RegisterAutoSell(
  $paymentConfig: PaymentConfigInput
  $poolSetting: PoolSettingInput
  $addOnFeature: AddOnFeatureInput
) {
  users {
    registerAutoSell(
      paymentConfig: $paymentConfig
      poolSetting: $poolSetting
      addOnFeature: $addOnFeature
    ) {
      code
      success
      message
      data
    }
  }
}
`;

export const UPDATE_AUTO_SELL_SETTING_MUTATION = `
mutation UpdateAutoSellSetting(
  $paymentConfig: PaymentConfigInput
  $poolSetting: PoolSettingInput
  $addOnFeature: AddOnFeatureInput
) {
  users {
    updateAutoSellSetting(
      paymentConfig: $paymentConfig
      poolSetting: $poolSetting
      addOnFeature: $addOnFeature
    ) {
      code
      success
      message
      data
    }
  }
}
`;

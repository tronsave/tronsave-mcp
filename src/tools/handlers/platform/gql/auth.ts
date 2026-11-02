export const AUTH_USER_INFO_QUERY = `
query getResourceAccount($address: TronAddress) {
  user(address: $address) {
    internalAcc {
      apiKey
    }
  }
}
`;

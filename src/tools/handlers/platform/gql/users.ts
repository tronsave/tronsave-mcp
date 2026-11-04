export const USER_INFO_QUERY = `
query getResourceAccount($address: TronAddress) {
  user(address: $address) {
    caller
    address
    balance
    info {
        createdBotCount
        contacts {
            type
            contactId
            isActive
            isVerify
            username
        }
        whitelistLevel
        userRefCode
        sponsor
        pendingRefCode
        totalRef
        totalPendingRef
        totalRefBonus
        remainRefBonus
        rank
    }
    internalAcc {
        depositAddress
        balance
        apiKey
    }
  }
}
`;

export const USER_AUTO_SETTING_QUERY = `
query GetUserAutoSetting {
  user {
    autoSettings {
      permitOperations {
        type
        id
        permissionName
        operations
      }
      energy {
        isActive
        minPrice
        minDelegateAmount
        maintainUnDelegate
        profitShare
        minDelegateDurationSec
        maxDelegateDurationSec
        isAcceptExtended
      }
      bandwidth {
        isActive
        minPrice
        minDelegateAmount
        maintainUnDelegate
        profitShare
        minDelegateDurationSec
        maxDelegateDurationSec
        isAcceptExtended
      }
      reclaimOnlyTronSave
      vote
      withdrawVote
      suggestSell
    }
  }
}
`;

export const USER_PERMISSIONS_QUERY = `
query GetUserPermissions {
  user {
    autoSettings {
      permitOperations {
        type
        id
        permissionName
        operations
      }
    }
  }
}
`;

export const GENERATE_API_KEY_MUTATION = `
mutation GenerateApiKey {
  users {
    generateApiKey {
      code
      success
      message
      data
    }
  }
}
`;

export const REVOKE_API_KEY_MUTATION = `
mutation RevokeApiKey {
  users {
    revokeApiKey {
      code
      success
      message
      data
    }
  }
}
`;

export const DELETE_AUTO_BUY_SETTING_MUTATION = `
mutation DeleteAutoBuySetting($id: MObjectId!) {
  users {
    deleteAutoBuySetting(id: $id) {
      code
      success
      message
    }
  }
}
`;

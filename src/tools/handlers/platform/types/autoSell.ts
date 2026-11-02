export type RegisterAutoSellMutationData = {
  users?: {
    registerAutoSell?: {
      code: number;
      success: boolean;
      message: string;
      data: string;
    };
  };
};

export type UpdateAutoSellSettingMutationData = {
  users?: {
    updateAutoSellSetting?: {
      code: number;
      success: boolean;
      message: string;
      data: string;
    };
  };
};

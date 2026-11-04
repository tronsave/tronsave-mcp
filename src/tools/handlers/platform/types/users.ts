export type GenerateApiKeyMutationData = {
  users?: { generateApiKey?: { code: number; success: boolean; message: string; data: string } };
};

export type RevokeApiKeyMutationData = {
  users?: { revokeApiKey?: { code: number; success: boolean; message: string; data: string } };
};

export type DeleteAutoBuySettingMutationData = {
  users?: { deleteAutoBuySetting?: { code: number; success: boolean; message: string } };
};

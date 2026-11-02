export type AuthUserInfoQueryData = {
  user?: {
    internalAcc?: {
      apiKey?: string | null;
    } | null;
  } | null;
};

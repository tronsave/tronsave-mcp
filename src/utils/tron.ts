import { TronWeb, Trx } from "tronweb";
import { AppError } from "./errors";

export const validateTronAddress = (walletAddress: string): boolean => TronWeb.isAddress(walletAddress);

export const assertValidTronAddress = (walletAddress: string): void => {
  if (!validateTronAddress(walletAddress)) {
    throw new AppError("Invalid TRON wallet address", 400, "INVALID_TRON_ADDRESS");
  }
};

export const verifyTronSignature = (message: string, signature: string, walletAddress: string): boolean => {
  const recoveredAddress = Trx.verifyMessageV2(message, signature);
  return recoveredAddress === walletAddress;
};

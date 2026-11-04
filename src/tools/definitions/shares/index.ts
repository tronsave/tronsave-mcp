import { z } from "zod";

export const EmptyInputSchema = z.object({}).strict();

/** TRON base58check address (mainnet and Nile both start with `T`, 34 chars). */
export const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const tronAddress = (description: string) =>
  z.string().trim().regex(TRON_ADDRESS_REGEX, "Must be a TRON base58 address (34 chars, starts with `T`).").describe(description);

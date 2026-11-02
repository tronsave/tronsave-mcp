export const getUnixTimestamp = (): number => Math.floor(Date.now() / 1000);

export const toIsoFromUnix = (timestamp: number): string => new Date(timestamp * 1000).toISOString();

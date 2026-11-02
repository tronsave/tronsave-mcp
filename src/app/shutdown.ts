import { logger } from "../utils/logger";

type Disposer = () => Promise<void>;

const disposers: Disposer[] = [];

export const registerDisposer = (fn: Disposer): void => {
  disposers.push(fn);
};

/**
 * Runs registered cleanup handlers in reverse order, swallowing errors so all
 * resources get a chance to terminate.
 */
export const runShutdown = async (): Promise<void> => {
  while (disposers.length > 0) {
    const disposer = disposers.pop();
    if (!disposer) {
      continue;
    }
    try {
      await disposer();
    } catch (error) {
      logger.error("Shutdown disposer failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

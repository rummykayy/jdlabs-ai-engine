/**
 * Error handling utility functions for TypeScript
 */

/**
 * Type guard to check if error has a message property
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Type guard to check if error has a code property
 */
export function isErrorWithCode(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

/**
 * Type guard to check if error has a name property
 */
export function isErrorWithName(error: unknown): error is { name: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as Record<string, unknown>).name === 'string'
  );
}

/**
 * Type guard to check if error has a type property
 */
export function isErrorWithType(error: unknown): error is { type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as Record<string, unknown>).type === 'string'
  );
}

/**
 * Safely get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Safely get error code from unknown error
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isErrorWithCode(error)) {
    return error.code;
  }
  return undefined;
}

/**
 * Check if error is a fetch/network error
 */
export function isFetchError(error: unknown): boolean {
  if (isErrorWithName(error) && error.name === 'FetchError') {
    return true;
  }
  if (isErrorWithCode(error) && error.code === 'ECONNREFUSED') {
    return true;
  }
  return false;
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (isErrorWithName(error) && error.name === 'AbortError') {
    return true;
  }
  if (isErrorWithType(error) && error.type === 'request-timeout') {
    return true;
  }
  return false;
}

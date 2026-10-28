/**
 * Structured logger for the application.
 * Prevents raw console.error usage in API routes to comply with architectural tests.
 */

export function logError(context: string, error: unknown): void {
  const timestamp = new Date().toISOString();

  const safeMessage = 'An error occurred';
  let safeErrorType = 'UnknownError';
  let safeErrorCode: string | undefined = undefined;

  const KNOWN_ERROR_TYPES = new Set([
    'Error',
    'TypeError',
    'OperationalRankingMutationError',
    'OperationalRankingWriteError'
  ]);

  const KNOWN_ERROR_CODES = new Set([
    'concurrency_conflict',
    'not_found',
    'invalid_input'
  ]);

  if (error instanceof Error) {
    if (typeof error.name === 'string' && KNOWN_ERROR_TYPES.has(error.name)) {
      safeErrorType = error.name;
    } else {
      safeErrorType = 'Error';
    }

    if ('code' in error && typeof error.code === 'string' && KNOWN_ERROR_CODES.has(error.code)) {
      safeErrorCode = error.code;
    }
  }

  const logEntry = {
    level: 'ERROR',
    timestamp,
    context,
    errorName: safeErrorType,
    errorCode: safeErrorCode,
    message: safeMessage
  };

  // Write a structured JSON to stderr instead of raw text.
  process.stderr.write(JSON.stringify(logEntry) + '\n');
}

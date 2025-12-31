// Shared constants
export const API_VERSION = 'v1';

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
} as const;

// Session timeout in milliseconds (15 minutes idle timeout)
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

// Absolute session timeout (12 hours) - NIST SP 800-63B-4 AAL2 requirement
export const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;

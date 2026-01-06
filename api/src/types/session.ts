/**
 * Express session type extensions for PIV OAuth state
 */

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    pivState?: string;
    pivNonce?: string;
    pivCodeVerifier?: string;
  }
}

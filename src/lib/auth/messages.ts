/**
 * User-facing auth message constants, shared between server actions and
 * their tests. Keep these generic — AUTH-02 requires one identical
 * "not eligible" message for every caller, with no admin-specific wording.
 */
export const AUTH_MESSAGES = {
  invalidEmail: "Enter a valid email address.",
  ineligible: "This email isn't eligible for this survey.",
  rateLimited:
    "You've asked for a code very recently. Wait a minute, then try again.",
  sendFailed: "We couldn't send a code just now. Please try again in a minute.",
  invalidCodeFormat: "Enter the 6-digit code from your email.",
  codeRejected:
    "That code didn't work. Check the code in your email or request a new one.",
  linkExpired:
    "That sign-in link has expired or was already used — request a new code.",
} as const;

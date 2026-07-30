/**
 * Single contact mailbox for the whole platform.
 *
 * Consolidated from the previously separate compliance@/privacy@/legal@/security@
 * addresses so every outbound email, restriction notice and support prompt points
 * members at one inbox. Mirrored in the web app at `src/constants/contact.js`.
 */
export const SUPPORT_EMAIL = 'admin@maritimelink.co';

/** Plain-text sentence for API error messages and login restriction notices. */
export const SUPPORT_CONTACT_SENTENCE = `Contact ${SUPPORT_EMAIL} if you need help.`;

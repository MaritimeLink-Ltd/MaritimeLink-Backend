import { env } from '../config/env.js';
import { SUPPORT_EMAIL } from '../config/contact.js';

/** MaritimeLink web app brand (matches MaritimeLink-Frontend). */
export const EMAIL_BRAND = {
  primary: '#003971',
  primaryDark: '#002455',
  primaryLight: '#005aad',
  accent: '#0ea5e9',
  surface: '#f4f7fb',
  card: '#ffffff',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  success: '#059669',
  successBg: '#ecfdf5',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  infoBg: '#eff6ff',
} as const;

/** Content-ID referencing the inline logo attachment added by emailService's `deliver`. */
export const EMAIL_LOGO_CID = 'maritimelink-logo';

export type EmailVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export type EmailCta = {
  label: string;
  url: string;
};

export type EmailLayoutParams = {
  headline: string;
  greeting?: string;
  bodyHtml: string;
  /** @deprecated Prefer `variant` */
  accentColor?: string;
  variant?: EmailVariant;
  preheader?: string;
  cta?: EmailCta;
};

const VARIANT_STYLES: Record<
  EmailVariant,
  { badgeBg: string; badgeColor: string; accent: string }
> = {
  brand: {
    badgeBg: EMAIL_BRAND.infoBg,
    badgeColor: EMAIL_BRAND.primary,
    accent: EMAIL_BRAND.primary,
  },
  success: {
    badgeBg: EMAIL_BRAND.successBg,
    badgeColor: EMAIL_BRAND.success,
    accent: EMAIL_BRAND.success,
  },
  warning: {
    badgeBg: EMAIL_BRAND.warningBg,
    badgeColor: EMAIL_BRAND.warning,
    accent: EMAIL_BRAND.warning,
  },
  danger: {
    badgeBg: EMAIL_BRAND.dangerBg,
    badgeColor: EMAIL_BRAND.danger,
    accent: EMAIL_BRAND.danger,
  },
  info: {
    badgeBg: EMAIL_BRAND.infoBg,
    badgeColor: EMAIL_BRAND.primaryLight,
    accent: EMAIL_BRAND.primaryLight,
  },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Standard body paragraph. */
export function emailParagraph(html: string): string {
  return `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.65; color: ${EMAIL_BRAND.text};">${html}</p>`;
}

/** Highlighted callout (reason, notes, amounts). */
export function emailCallout(
  html: string,
  variant: EmailVariant = 'brand',
): string {
  const v = VARIANT_STYLES[variant];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border-collapse: collapse;">
      <tr>
        <td style="background-color: ${v.badgeBg}; border-left: 4px solid ${v.accent}; border-radius: 0 12px 12px 0; padding: 16px 18px; font-size: 15px; line-height: 1.6; color: ${EMAIL_BRAND.text};">
          ${html}
        </td>
      </tr>
    </table>`;
}

/**
 * Inline `mailto:` link to the platform support mailbox, for use inside body copy.
 * Keeps every "contact us" prompt pointing at the same inbox.
 */
export function supportEmailLink(): string {
  return `<a href="mailto:${SUPPORT_EMAIL}" style="color: ${EMAIL_BRAND.primaryLight}; text-decoration: underline;">${SUPPORT_EMAIL}</a>`;
}

/** OTP / verification code block. */
export function emailOtpBlock(code: string): string {
  const safe = escapeHtml(code);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border-collapse: collapse;">
      <tr>
        <td align="center" style="background: linear-gradient(135deg, ${EMAIL_BRAND.infoBg} 0%, #dbeafe 100%); border: 1px solid ${EMAIL_BRAND.border}; border-radius: 16px; padding: 28px 20px;">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${EMAIL_BRAND.textMuted};">Your verification code</p>
          <p style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 0.35em; color: ${EMAIL_BRAND.primary}; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${safe}</p>
        </td>
      </tr>
    </table>
    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: ${EMAIL_BRAND.textMuted}; text-align: center;">Expires in 10 minutes. Do not share this code.</p>`;
}

function resolveVariant(params: EmailLayoutParams): EmailVariant {
  if (params.variant) return params.variant;
  const c = params.accentColor?.toLowerCase();
  if (c === '#16a34a' || c === '#059669') return 'success';
  if (c === '#dc2626') return 'danger';
  if (c === '#d97706') return 'warning';
  if (c === '#2563eb') return 'info';
  return 'brand';
}

function buildCtaButton(cta: EmailCta): string {
  const label = escapeHtml(cta.label);
  const url = escapeHtml(cta.url);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0 8px; border-collapse: collapse;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, ${EMAIL_BRAND.primary} 0%, ${EMAIL_BRAND.primaryLight} 100%); background-color: ${EMAIL_BRAND.primary}; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(0, 57, 113, 0.35); letter-spacing: 0.02em;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

/**
 * Responsive, brand-aligned HTML email shell (table layout for client compatibility).
 */
export function buildEmailHtml(params: EmailLayoutParams): string {
  const { headline, greeting, bodyHtml, preheader, cta } = params;
  const variant = resolveVariant(params);
  const v = VARIANT_STYLES[variant];
  const safeHeadline = escapeHtml(headline);
  const safeGreeting = greeting ? escapeHtml(greeting) : '';
  const year = new Date().getFullYear();
  const dashboardBase = appUrl('/');

  const preheaderHtml = preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">${escapeHtml(preheader)}</div>`
    : '';

  const greetingHtml = safeGreeting
    ? `<p style="margin: 0 0 20px; font-size: 17px; line-height: 1.5; color: ${EMAIL_BRAND.text}; font-weight: 500;">${safeGreeting}</p>`
    : '';

  const ctaBlock = cta ? buildCtaButton(cta) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${safeHeadline}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_BRAND.surface}; -webkit-font-smoothing: antialiased;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${EMAIL_BRAND.surface}; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; border-collapse: collapse;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${EMAIL_BRAND.primary} 0%, ${EMAIL_BRAND.primaryLight} 55%, ${EMAIL_BRAND.accent} 100%); background-color: ${EMAIL_BRAND.primary}; border-radius: 20px 20px 0 0; padding: 36px 40px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" width="52" style="padding-right: 14px;">
                    <table role="presentation" width="52" height="52" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                      <tr>
                        <td align="center" valign="middle" width="52" height="52" style="background-color: #ffffff; border-radius: 12px;">
                          <img src="cid:${EMAIL_LOGO_CID}" width="34" height="34" alt="MaritimeLink" style="display: block;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle">
                    <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85);">MaritimeLink</p>
                    <p style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing: -0.02em;">Connect. Comply. Grow.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body card -->
          <tr>
            <td style="background-color: ${EMAIL_BRAND.card}; border: 1px solid ${EMAIL_BRAND.border}; border-top: none; padding: 36px 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom: 8px;">
                    <span style="display: inline-block; background-color: ${v.badgeBg}; color: ${v.badgeColor}; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 12px; border-radius: 999px; margin-bottom: 14px;">Notification</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 800; line-height: 1.25; color: ${EMAIL_BRAND.primary}; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing: -0.03em;">${safeHeadline}</h1>
                  </td>
                </tr>
              </table>
              ${greetingHtml}
              <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                ${bodyHtml}
              </div>
              ${ctaBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: ${EMAIL_BRAND.primaryDark}; border-radius: 0 0 20px 20px; padding: 28px 40px; border: 1px solid ${EMAIL_BRAND.primaryDark}; border-top: none;">
              <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #ffffff;">MaritimeLink</p>
              <p style="margin: 0 0 16px; font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.75);">
                Maritime careers, compliance, and training — in one platform.
              </p>
              <p style="margin: 0 0 8px; font-size: 12px; color: rgba(255,255,255,0.55);">
                <a href="${escapeHtml(dashboardBase)}" style="color: #7dd3fc; text-decoration: none;">Visit MaritimeLink</a>
              </p>
              <p style="margin: 0 0 8px; font-size: 12px; color: rgba(255,255,255,0.55);">
                Need help? Contact us at
                <a href="mailto:${SUPPORT_EMAIL}" style="color: #7dd3fc; text-decoration: none;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin: 16px 0 0; font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.45);">
                © ${year} MaritimeLink. If you did not expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function appUrl(path: string): string {
  const base = env.FRONTEND_URL.replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** Human-readable label for admin participants in chat (e.g. "Umair (Admin)"). */
export const formatAdminChatDisplayName = (
  admin?: {
    email?: string | null;
  } | null,
): string => {
  if (!admin) return 'Support (Admin)';
  const email = String(admin.email || '').trim();
  if (!email) return 'Support (Admin)';
  const local = email.split('@')[0] || '';
  const pretty = local
    .replace(/[._+-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return pretty ? `${pretty} (Admin)` : 'Support (Admin)';
};

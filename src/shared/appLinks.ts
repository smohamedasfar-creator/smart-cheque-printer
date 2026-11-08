// Contact and project links shown in Help & About. These are the only addresses the app will ever open.

// Release builds carry only the developer credit: payment links, phone numbers and the source repository stay
// empty here, and every place that shows them is hidden while they are empty.
export const APP_LINKS = {
  /** Shown as "Developed by …" in Help & About. Hidden while empty. */
  developerName: 'Asfar',
  supportEmail: 'support@optizer.ae',
  /** Phone / WhatsApp for customization requests, international format without "+" (e.g. 9715XXXXXXXX). Hidden while empty. */
  contactPhone: '',
  /** Donation page (GitHub Sponsors, PayPal, …). The button is hidden while this is empty. */
  supportDeveloperUrl: '',
  /** Botim number for payments inside the UAE, international format without "+". Hidden while empty. */
  botimNumber: '',
  /** Public source code repository. The link is hidden while this is empty. */
  sourceCodeUrl: '',
} as const;

export type AppLink = 'email' | 'whatsapp' | 'call' | 'support' | 'source';

/** "+971 50 123 4567" style display of the contact number. */
export function displayPhone(digits: string = APP_LINKS.contactPhone): string {
  const m = /^(971)(\d{2})(\d{3})(\d{4})$/.exec(digits);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${digits}`;
}

/** Resolves a link name to its address, or null when it is not configured. */
export function resolveAppLink(link: AppLink): string | null {
  const subject = encodeURIComponent('Smart Cheque Printer');
  switch (link) {
    case 'email': return `mailto:${APP_LINKS.supportEmail}?subject=${subject}`;
    case 'whatsapp': return APP_LINKS.contactPhone ? `https://wa.me/${APP_LINKS.contactPhone}?text=${encodeURIComponent('Hello, I use Smart Cheque Printer and would like a customization.')}` : null;
    case 'call': return APP_LINKS.contactPhone ? `tel:+${APP_LINKS.contactPhone}` : null;
    case 'support': return APP_LINKS.supportDeveloperUrl.startsWith('https://') ? APP_LINKS.supportDeveloperUrl : null;
    case 'source': return APP_LINKS.sourceCodeUrl.startsWith('https://') ? APP_LINKS.sourceCodeUrl : null;
    default: return null;
  }
}

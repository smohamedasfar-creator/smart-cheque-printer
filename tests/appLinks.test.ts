import { describe, expect, test } from 'vitest';
import { APP_LINKS, displayPhone, resolveAppLink } from '../src/shared/appLinks';

describe('resolveAppLink', () => {
  test('opens the support email with a subject', () => {
    expect(resolveAppLink('email')).toBe(`mailto:${APP_LINKS.supportEmail}?subject=Smart%20Cheque%20Printer`);
    expect(APP_LINKS.supportEmail).toBe('support@optizer.ae');
  });

  test('WhatsApp and call links follow the configured number', () => {
    if (APP_LINKS.contactPhone) {
      expect(resolveAppLink('whatsapp')).toMatch(new RegExp(`^https://wa\\.me/${APP_LINKS.contactPhone}\\?text=`));
      expect(resolveAppLink('call')).toBe(`tel:+${APP_LINKS.contactPhone}`);
    } else {
      expect(resolveAppLink('whatsapp')).toBeNull();
      expect(resolveAppLink('call')).toBeNull();
    }
  });

  test('the release build carries only the developer credit: no payment link, phone or repository', () => {
    expect(APP_LINKS.developerName).toBe('Asfar');
    expect(resolveAppLink('support')).toBeNull();
    expect(resolveAppLink('source')).toBeNull();
    expect(APP_LINKS.botimNumber).toBe('');
    expect(JSON.stringify(APP_LINKS)).not.toMatch(/ziina|smohamed|563686538|botim\.me/i);
  });

  test('only opens configured https links', () => {
    for (const link of ['support', 'source'] as const) {
      const url = resolveAppLink(link);
      expect(url === null || url.startsWith('https://')).toBe(true);
    }
  });

  test('rejects unknown link names', () => {
    expect(resolveAppLink('file' as never)).toBeNull();
  });
});

describe('displayPhone', () => {
  test('formats a UAE mobile number', () => {
    expect(displayPhone('971501234567')).toBe('+971 50 123 4567');
    expect(displayPhone('441234')).toBe('+441234');
  });
});

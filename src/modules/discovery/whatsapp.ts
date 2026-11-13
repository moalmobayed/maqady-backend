import { WHATSAPP_URL_BASE } from './discovery.constants';

/**
 * The WhatsApp click-to-chat link of an E.164 number (#29): `+201001234567` becomes
 * `https://wa.me/201001234567`, the full international number without `+`.
 */
export function whatsAppUrl(number: string): string {
  return `${WHATSAPP_URL_BASE}${number.replace(/^\+/, '')}`;
}

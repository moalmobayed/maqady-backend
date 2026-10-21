/**
 * What binds a message's encrypted parameters to its row (`payload_ciphertext`), so a
 * ciphertext copied to another row can't be decrypted there.
 */
export function payloadAad(id: number): string {
  return `messages:${id}`;
}

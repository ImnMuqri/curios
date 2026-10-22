import { constants, verify } from 'node:crypto';

/**
 * Whether `rawBody` was signed by the holder of the private half of `publicKeyPem`.
 *
 * CHIP signs the exact bytes it POSTs, RSA PKCS#1 v1.5 over SHA-256, and sends the
 * signature base64-encoded in the `X-Signature` header. So this must be given the raw
 * body as received, never a re-serialised parse of it. False rather than throwing for
 * anything malformed -- a missing signature, a bad key, junk base64: a false here must
 * always mean "do not grant", with no path around it.
 */
export function verifyChipSignature(
  rawBody: string,
  signature: string | undefined,
  publicKeyPem: string,
): boolean {
  if (!signature || !publicKeyPem) return false;
  // Buffer.from(..., 'base64') silently drops junk, so refuse anything that is not
  // strictly base64 before it can decode to something that happens to verify.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length % 4 !== 0) return false;
  try {
    return verify(
      'sha256',
      Buffer.from(rawBody),
      { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * `GET /public_key/` answers a JSON-encoded PEM string (quotes and escaped newlines
 * included), not a bare PEM. Decodes it, and throws on anything that is not a PEM
 * public key so a changed response shape fails loudly instead of verifying nothing.
 */
export function parsePublicKey(body: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new Error('CHIP returned a public key that is not JSON');
  }
  if (
    typeof decoded !== 'string' ||
    !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(decoded)
  ) {
    throw new Error('CHIP returned a public key that is not a PEM');
  }
  return decoded;
}

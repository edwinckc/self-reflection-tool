/**
 * PAT encryption module using Web Crypto API.
 * Derives an AES-GCM key from user email + app secret,
 * then encrypts/decrypts GitHub PATs for safe storage.
 */

const APP_SECRET = 'self-reflection-tool-v1-secret';
const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

/**
 * Derive a deterministic AES key from the user's email.
 * Uses PBKDF2 with a fixed salt derived from the app secret.
 */
async function deriveKey(email) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(email + APP_SECRET),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const salt = encoder.encode(APP_SECRET);

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext token string.
 * Returns a base64-encoded string containing IV + ciphertext.
 */
export async function encryptToken(token, email) {
  const key = await deriveKey(email);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(token);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  );

  // Concatenate IV + ciphertext, then base64-encode
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded encrypted token string.
 * Returns the original plaintext token.
 */
export async function decryptToken(encryptedToken, email) {
  const key = await deriveKey(email);
  const combined = Uint8Array.from(atob(encryptedToken), c => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * ZeroBin Crypto Module
 * Zero-knowledge encryption using Web Crypto API
 * - AES-256-GCM for symmetric encryption
 * - PBKDF2 for password-based key derivation
 * - Key lives in URL fragment, never sent to server
 */

const ZeroBinCrypto = (() => {
  'use strict';

  const ALGO = 'AES-GCM';
  const KEY_BITS = 256;
  const IV_BYTES = 12;
  const TAG_BITS = 128;
  const PBKDF2_ITERATIONS = 310000;
  const SALT_BYTES = 32;

  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // --- Base58 encoding/decoding ---

  function base58Encode(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes);
    }
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let result = '';
    // leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      result += BASE58_ALPHABET[0];
    }
    for (let i = digits.length - 1; i >= 0; i--) {
      result += BASE58_ALPHABET[digits[i]];
    }
    return result;
  }

  function base58Decode(str) {
    if (typeof str !== 'string' || str.length === 0) {
      throw new Error('Invalid base58 string');
    }
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const charIndex = BASE58_ALPHABET.indexOf(str[i]);
      if (charIndex < 0) throw new Error(`Invalid base58 character: ${str[i]}`);
      let carry = charIndex;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    // leading zeros
    for (let i = 0; i < str.length && str[i] === BASE58_ALPHABET[0]; i++) {
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }

  // --- Key generation ---

  function generateRandomKey() {
    const keyBytes = new Uint8Array(KEY_BITS / 8);
    crypto.getRandomValues(keyBytes);
    return base58Encode(keyBytes);
  }

  function generatePasteId() {
    const idBytes = new Uint8Array(8);
    crypto.getRandomValues(idBytes);
    return base58Encode(idBytes);
  }

  // --- Key derivation ---

  async function deriveKey(keyBase58, password, salt) {
    const rawKey = base58Decode(keyBase58);

    if (!password) {
      return crypto.subtle.importKey('raw', rawKey, { name: ALGO }, false, [
        'encrypt',
        'decrypt',
      ]);
    }

    // Combine URL key + password for PBKDF2
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const combined = new Uint8Array(rawKey.length + passwordBytes.length);
    combined.set(rawKey);
    combined.set(passwordBytes, rawKey.length);

    const baseKey = await crypto.subtle.importKey('raw', combined, { name: 'PBKDF2' }, false, [
      'deriveKey',
    ]);

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      baseKey,
      { name: ALGO, length: KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // --- Encrypt ---

  async function encrypt(plaintext, keyBase58, password = '') {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const encoder = new TextEncoder();

    // Authenticated data: version + algorithm info
    const adata = encoder.encode(
      JSON.stringify(['aes', 'gcm', KEY_BITS, TAG_BITS, PBKDF2_ITERATIONS, 2])
    );

    const key = await deriveKey(keyBase58, password, salt);

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGO, iv: iv, additionalData: adata, tagLength: TAG_BITS },
      key,
      encoder.encode(JSON.stringify(plaintext))
    );

    return {
      v: 2,
      iv: arrayToBase64(iv),
      salt: arrayToBase64(salt),
      ct: arrayToBase64(new Uint8Array(ciphertext)),
      adata: arrayToBase64(adata),
    };
  }

  // --- Decrypt ---

  async function decrypt(data, keyBase58, password = '') {
    const iv = base64ToArray(data.iv);
    const salt = base64ToArray(data.salt);
    const ct = base64ToArray(data.ct);
    const adata = base64ToArray(data.adata);

    const key = await deriveKey(keyBase58, password, salt);

    const plaintext = await crypto.subtle.decrypt(
      { name: ALGO, iv: iv, additionalData: adata, tagLength: TAG_BITS },
      key,
      ct
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(plaintext));
  }

  // --- Base64 helpers ---

  function arrayToBase64(arr) {
    let binary = '';
    for (let i = 0; i < arr.length; i++) {
      binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
  }

  function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // --- Public API ---

  return {
    encrypt,
    decrypt,
    generateRandomKey,
    generatePasteId,
    base58Encode,
    base58Decode,
    arrayToBase64,
    base64ToArray,
    PBKDF2_ITERATIONS,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZeroBinCrypto;
}

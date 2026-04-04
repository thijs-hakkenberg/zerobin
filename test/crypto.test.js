import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';

// Polyfill for Node.js test environment
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
if (!globalThis.btoa) {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (!globalThis.atob) {
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// Load the module by evaluating it with globalThis assignment
const fs = await import('node:fs');
const pathMod = await import('node:path');
const code = fs.readFileSync(pathMod.resolve('./public/js/crypto.js'), 'utf-8');
const wrappedCode = code
  .replace('const ZeroBinCrypto = (() => {', 'globalThis.ZeroBinCrypto = (() => {')
  .replace(/if \(typeof module !== 'undefined' && module\.exports\)[\s\S]*$/, '');
new Function(wrappedCode)();

const Crypto = globalThis.ZeroBinCrypto;

describe('Base58', () => {
  it('encodes and decodes round-trip', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
    const encoded = Crypto.base58Encode(original);
    const decoded = Crypto.base58Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles leading zeros', () => {
    const original = new Uint8Array([0, 0, 0, 1, 2]);
    const encoded = Crypto.base58Encode(original);
    expect(encoded.startsWith('111')).toBe(true);
    const decoded = Crypto.base58Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('rejects invalid characters', () => {
    expect(() => Crypto.base58Decode('0OIl')).toThrow('Invalid base58 character');
  });

  it('rejects empty string', () => {
    expect(() => Crypto.base58Decode('')).toThrow('Invalid base58 string');
  });
});

describe('Base64 helpers', () => {
  it('round-trips correctly', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = Crypto.arrayToBase64(original);
    const decoded = Crypto.base64ToArray(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe('Key generation', () => {
  it('generateRandomKey returns base58 string', () => {
    const key = Crypto.generateRandomKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(30);
    // Should decode without error
    const decoded = Crypto.base58Decode(key);
    expect(decoded.length).toBe(32); // 256 bits
  });

  it('generatePasteId returns base58 string', () => {
    const id = Crypto.generatePasteId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(5);
    const decoded = Crypto.base58Decode(id);
    expect(decoded.length).toBe(8);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 20 }, () => Crypto.generateRandomKey()));
    expect(keys.size).toBe(20);
  });
});

describe('Encrypt / Decrypt', () => {
  it('round-trips plaintext without password', async () => {
    const key = Crypto.generateRandomKey();
    const plaintext = { content: 'Hello, World!', format: 'plaintext' };
    const encrypted = await Crypto.encrypt(plaintext, key);
    expect(encrypted.v).toBe(2);
    expect(encrypted.ct).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.salt).toBeDefined();

    const decrypted = await Crypto.decrypt(encrypted, key);
    expect(decrypted).toEqual(plaintext);
  });

  it('round-trips with password', async () => {
    const key = Crypto.generateRandomKey();
    const password = 'my-secret-password';
    const plaintext = { content: 'Secret data', format: 'markdown' };
    const encrypted = await Crypto.encrypt(plaintext, key, password);
    const decrypted = await Crypto.decrypt(encrypted, key, password);
    expect(decrypted).toEqual(plaintext);
  });

  it('fails to decrypt with wrong key', async () => {
    const key1 = Crypto.generateRandomKey();
    const key2 = Crypto.generateRandomKey();
    const plaintext = { content: 'test' };
    const encrypted = await Crypto.encrypt(plaintext, key1);
    await expect(Crypto.decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('fails to decrypt with wrong password', async () => {
    const key = Crypto.generateRandomKey();
    const plaintext = { content: 'test' };
    const encrypted = await Crypto.encrypt(plaintext, key, 'correct');
    await expect(Crypto.decrypt(encrypted, key, 'wrong')).rejects.toThrow();
  });

  it('handles large content', async () => {
    const key = Crypto.generateRandomKey();
    const largeContent = 'x'.repeat(100000);
    const plaintext = { content: largeContent };
    const encrypted = await Crypto.encrypt(plaintext, key);
    const decrypted = await Crypto.decrypt(encrypted, key);
    expect(decrypted.content.length).toBe(100000);
  });

  it('handles unicode content', async () => {
    const key = Crypto.generateRandomKey();
    const plaintext = { content: 'Hello 🌍 世界 مرحبا' };
    const encrypted = await Crypto.encrypt(plaintext, key);
    const decrypted = await Crypto.decrypt(encrypted, key);
    expect(decrypted).toEqual(plaintext);
  });

  it('handles file attachment data', async () => {
    const key = Crypto.generateRandomKey();
    const plaintext = {
      content: 'Check this file',
      attachment: {
        name: 'test.txt',
        type: 'text/plain',
        data: Crypto.arrayToBase64(new TextEncoder().encode('file contents')),
      },
    };
    const encrypted = await Crypto.encrypt(plaintext, key);
    const decrypted = await Crypto.decrypt(encrypted, key);
    expect(decrypted.attachment.name).toBe('test.txt');
  });
});

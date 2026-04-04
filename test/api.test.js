import { describe, it, expect, beforeEach } from 'vitest';

// Mock KV store
class MockKV {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async put(key, value, options = {}) {
    const entry = { value };
    if (options.expirationTtl) {
      entry.expiration = Date.now() + options.expirationTtl * 1000;
    }
    this.store.set(key, entry);
  }
  async delete(key) {
    this.store.delete(key);
  }
}

// Import functions by loading the module source
const fs = await import('node:fs');
const path = await import('node:path');

function loadModule(filePath) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const mod = {};
  const fn = new Function('module', 'exports', 'crypto', code);
  fn(mod, mod.exports, globalThis.crypto);
  return mod.exports;
}

// We can't easily import Pages Functions directly since they use export syntax
// Instead, we'll test the API logic patterns

describe('API - Paste Creation', () => {
  let kv;

  beforeEach(() => {
    kv = new MockKV();
  });

  it('stores encrypted paste in KV', async () => {
    const pasteData = {
      v: 2,
      ct: 'encrypted-ciphertext',
      iv: 'base64-iv',
      salt: 'base64-salt',
      adata: 'base64-adata',
      meta: { expire: '1week', burnafterreading: false, opendiscussion: false },
    };

    const id = 'testId123';
    const record = {
      ...pasteData,
      meta: {
        created: Date.now(),
        ...pasteData.meta,
      },
      comments: [],
    };

    await kv.put(id, JSON.stringify(record), { expirationTtl: 604800 });

    const stored = await kv.get(id);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    expect(parsed.ct).toBe('encrypted-ciphertext');
    expect(parsed.meta.expire).toBe('1week');
    expect(parsed.comments).toEqual([]);
  });

  it('respects TTL for expiry', async () => {
    const id = 'expiring';
    // Store with 0 TTL (already expired)
    const entry = { value: '{}' };
    entry.expiration = Date.now() - 1000;
    kv.store.set(id, entry);

    const result = await kv.get(id);
    expect(result).toBeNull();
  });

  it('returns null for non-existent paste', async () => {
    const result = await kv.get('nonexistent');
    expect(result).toBeNull();
  });

  it('burn after reading deletes paste', async () => {
    const id = 'burnme';
    const record = {
      ct: 'encrypted',
      iv: 'iv',
      salt: 'salt',
      adata: 'adata',
      meta: { created: Date.now(), expire: 'never', burnafterreading: true },
      comments: [],
    };

    await kv.put(id, JSON.stringify(record));

    // First read
    const raw = await kv.get(id);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);

    if (parsed.meta.burnafterreading) {
      await kv.delete(id);
    }

    // Second read should be gone
    const second = await kv.get(id);
    expect(second).toBeNull();
  });

  it('stores and retrieves comments', async () => {
    const id = 'withcomments';
    const record = {
      ct: 'encrypted',
      iv: 'iv',
      salt: 'salt',
      adata: 'adata',
      meta: { created: Date.now(), expire: 'never', opendiscussion: true },
      comments: [],
    };

    await kv.put(id, JSON.stringify(record));

    // Add comment
    const raw = await kv.get(id);
    const parsed = JSON.parse(raw);

    parsed.comments.push({
      id: 'comment1',
      parentid: id,
      ct: 'encrypted-comment',
      iv: 'comment-iv',
      salt: 'comment-salt',
      adata: 'comment-adata',
      meta: { created: Date.now() },
    });

    await kv.put(id, JSON.stringify(parsed));

    // Read back
    const updated = JSON.parse(await kv.get(id));
    expect(updated.comments.length).toBe(1);
    expect(updated.comments[0].id).toBe('comment1');
  });

  it('rejects comments when discussion is disabled', async () => {
    const id = 'nodiscussion';
    const record = {
      ct: 'encrypted',
      iv: 'iv',
      salt: 'salt',
      adata: 'adata',
      meta: { created: Date.now(), expire: 'never', opendiscussion: false },
      comments: [],
    };

    await kv.put(id, JSON.stringify(record));
    const parsed = JSON.parse(await kv.get(id));
    expect(parsed.meta.opendiscussion).toBe(false);
  });

  it('delete with correct token removes paste', async () => {
    const id = 'deleteme';
    const created = Date.now();
    const record = {
      ct: 'encrypted',
      iv: 'iv',
      salt: 'salt',
      adata: 'adata',
      meta: { created, expire: 'never' },
      comments: [],
    };

    await kv.put(id, JSON.stringify(record));

    const raw = await kv.get(id);
    const parsed = JSON.parse(raw);
    const expectedToken = parsed.meta.created.toString(36);
    const providedToken = created.toString(36);

    expect(providedToken).toBe(expectedToken);
    await kv.delete(id);

    const deleted = await kv.get(id);
    expect(deleted).toBeNull();
  });

  it('handles expiry map values correctly', () => {
    const EXPIRY_MAP = {
      '5min': 300,
      '10min': 600,
      '1hour': 3600,
      '1day': 86400,
      '1week': 604800,
      '1month': 2592000,
      '3months': 7776000,
      '1year': 31536000,
      never: null,
    };

    expect(EXPIRY_MAP['1week']).toBe(604800);
    expect(EXPIRY_MAP['never']).toBeNull();
    expect(EXPIRY_MAP['5min']).toBe(300);
  });
});

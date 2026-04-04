/**
 * POST /api/paste - Create a new paste
 * Stores encrypted data in KV with optional TTL for expiry
 */

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

const MAX_PASTE_SIZE = 10 * 1024 * 1024; // 10MB

function generateId() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const body = await context.request.json();

    if (!body || !body.ct || !body.iv || !body.salt || !body.adata) {
      return Response.json({ error: 'Missing required encrypted fields' }, { status: 400 });
    }

    const dataStr = JSON.stringify(body);
    if (dataStr.length > MAX_PASTE_SIZE) {
      return Response.json(
        { error: `Paste too large. Maximum size is ${MAX_PASTE_SIZE / 1024 / 1024}MB` },
        { status: 413 }
      );
    }

    const id = generateId();
    const expire = body.meta?.expire || 'never';
    const ttl = EXPIRY_MAP[expire];

    const record = {
      v: body.v || 2,
      ct: body.ct,
      iv: body.iv,
      salt: body.salt,
      adata: body.adata,
      meta: {
        created: Date.now(),
        expire: expire,
        burnafterreading: !!body.meta?.burnafterreading,
        opendiscussion: !!body.meta?.opendiscussion,
      },
      comments: [],
    };

    const kvOptions = {};
    if (ttl) {
      kvOptions.expirationTtl = ttl;
    }

    await env.PASTES.put(id, JSON.stringify(record), kvOptions);

    return Response.json({ id, deletetoken: record.meta.created.toString(36) }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

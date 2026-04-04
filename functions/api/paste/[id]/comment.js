/**
 * POST /api/paste/:id/comment - Add a comment to a paste's discussion
 * Comments are encrypted client-side, stored alongside the paste
 */

function generateCommentId() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const pasteId = params.id;

  try {
    const raw = await env.PASTES.get(pasteId);
    if (!raw) {
      return Response.json({ error: 'Paste not found or has expired' }, { status: 404 });
    }

    const record = JSON.parse(raw);

    if (!record.meta?.opendiscussion) {
      return Response.json({ error: 'Discussion is not enabled for this paste' }, { status: 403 });
    }

    const body = await context.request.json();

    if (!body || !body.ct || !body.iv || !body.salt || !body.adata) {
      return Response.json({ error: 'Missing required encrypted fields' }, { status: 400 });
    }

    const comment = {
      id: generateCommentId(),
      parentid: body.parentid || pasteId,
      ct: body.ct,
      iv: body.iv,
      salt: body.salt,
      adata: body.adata,
      meta: {
        created: Date.now(),
      },
    };

    record.comments = record.comments || [];
    record.comments.push(comment);

    // Re-store with same expiry logic
    const kvOptions = {};
    const EXPIRY_MAP = {
      '5min': 300,
      '10min': 600,
      '1hour': 3600,
      '1day': 86400,
      '1week': 604800,
      '1month': 2592000,
      '3months': 7776000,
      '1year': 31536000,
    };
    const ttl = EXPIRY_MAP[record.meta.expire];
    if (ttl) {
      // Recalculate remaining TTL from creation time
      const elapsed = Math.floor((Date.now() - record.meta.created) / 1000);
      const remaining = ttl - elapsed;
      if (remaining > 60) {
        kvOptions.expirationTtl = remaining;
      }
    }

    await env.PASTES.put(pasteId, JSON.stringify(record), kvOptions);

    return Response.json({ id: comment.id }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

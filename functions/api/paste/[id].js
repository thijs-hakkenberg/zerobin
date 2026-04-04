/**
 * GET /api/paste/:id - Read a paste
 * DELETE /api/paste/:id - Delete a paste
 */

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;

  try {
    const raw = await env.PASTES.get(id);
    if (!raw) {
      return Response.json({ error: 'Paste not found or has expired' }, { status: 404 });
    }

    const record = JSON.parse(raw);

    // Burn after reading: delete after first read
    if (record.meta?.burnafterreading) {
      await env.PASTES.delete(id);
    }

    return Response.json(record);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;
  const deletetoken = new URL(context.request.url).searchParams.get('deletetoken');

  try {
    const raw = await env.PASTES.get(id);
    if (!raw) {
      return Response.json({ error: 'Paste not found' }, { status: 404 });
    }

    const record = JSON.parse(raw);
    const expectedToken = record.meta.created.toString(36);

    if (deletetoken !== expectedToken) {
      return Response.json({ error: 'Invalid delete token' }, { status: 403 });
    }

    await env.PASTES.delete(id);
    return Response.json({ status: 'deleted' });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { admin, handle, json } from '../_shared/common.ts';

async function googleToken(): Promise<string | null> {
  const id = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET'), refresh = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if (!id || !secret || !refresh) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' })
  });
  const data = await res.json();
  return res.ok ? (data.access_token as string) : null;
}

const hdr = (m: any, name: string) => m?.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name)?.value ?? '';

Deno.serve(handle(async (b) => {
  const db = admin();

  // Atualização de status (aprovar / dispensar) vinda do app
  if (b.action === 'update') {
    if (!['approved', 'dismissed'].includes(b.status)) return json({ error: 'status inválido' }, 400);
    await db.from('proactive_actions').update({ status: b.status }).eq('id', String(b.id));
    return json({ ok: true });
  }

  // Sincronização (chamada pelo app e pelo cron do Supabase)
  const token = await googleToken();
  const candidates: { source: string; summary: string; detail?: string; primary_label: string; action_type: string; payload?: Record<string, string> }[] = [];

  if (token) {
    const auth = { Authorization: `Bearer ${token}` };
    const list = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread%20in:inbox&maxResults=10', { headers: auth }).then((r) => r.json());
    const ids: string[] = (list?.messages ?? []).map((m: any) => m.id);
    const metas = await Promise.all(ids.map((id) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: auth }).then((r) => r.json())
    ));
    const fromLinkedIn = metas.filter((m) => /linkedin\.com/i.test(hdr(m, 'from')));
    if (fromLinkedIn.length) {
      candidates.push({
        source: 'LinkedIn', primary_label: 'Responder', action_type: 'handoff',
        summary: `${fromLinkedIn.length} mensage${fromLinkedIn.length > 1 ? 'ns' : 'm'} no LinkedIn aguardando resposta (rascunhos prontos para revisar)`,
        payload: { url: 'linkedin.com/messaging' }
      });
    }
    const others = metas.length - fromLinkedIn.length;
    if (others > 0) {
      candidates.push({
        source: 'Gmail', primary_label: 'Resumir', action_type: 'quick',
        summary: `${others} e-mail${others > 1 ? 's' : ''} não lido${others > 1 ? 's' : ''} no Gmail. Último: "${hdr(metas.find((m) => !/linkedin\.com/i.test(hdr(m, 'from'))), 'subject').slice(0, 80)}"`
      });
    }

    const nowIso = new Date().toISOString();
    const endIso = new Date(Date.now() + 24 * 3600_000).toISOString();
    const cal = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(nowIso)}&timeMax=${encodeURIComponent(endIso)}&singleEvents=true&orderBy=startTime&maxResults=5`,
      { headers: auth }
    ).then((r) => r.json());
    const first = cal?.items?.[0];
    if (first) {
      const when = first.start?.dateTime ? new Date(first.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'dia todo';
      candidates.push({
        source: 'Agenda', primary_label: 'Ver agenda', action_type: 'quick',
        summary: `${cal.items.length} evento${cal.items.length > 1 ? 's' : ''} nas próximas 24h. Próximo: "${String(first.summary || 'Sem título').slice(0, 60)}" (${when})`
      });
    }
  }

  // Dispensa pendentes antigos e insere só o que ainda não existe (evita duplicar a cada sync)
  await db.from('proactive_actions').update({ status: 'dismissed' }).eq('status', 'pending').lt('created_at', new Date(Date.now() - 3 * 24 * 3600_000).toISOString());
  const { data: pending } = await db.from('proactive_actions').select('summary').eq('status', 'pending');
  const known = new Set((pending ?? []).map((p: any) => p.summary));
  const fresh = candidates.filter((c) => !known.has(c.summary));
  if (fresh.length) await db.from('proactive_actions').insert(fresh.map((c) => ({ ...c, detail: c.detail ?? null, payload: c.payload ?? {} })));

  const { data: actions } = await db.from('proactive_actions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
  return json({ actions: actions ?? [], googleConnected: Boolean(token) });
}));

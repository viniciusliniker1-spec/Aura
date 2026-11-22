// Gmail e Google Agenda (somente leitura) pela API oficial, com o refresh token do projeto.
// Ler e-mail pela API é mais rápido e seguro do que logar no Gmail pelo navegador (o Google bloqueia login automatizado).

export async function googleToken(): Promise<string | null> {
  const id = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET'), refresh = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if (!id || !secret || !refresh) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    return res.ok ? (data.access_token as string) : null;
  } catch { return null; }
}

const hdr = (m: any, name: string) => m?.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name)?.value ?? '';

export interface MailItem { from: string; subject: string; date: string; snippet: string; unread: boolean }

/** Busca no Gmail (sintaxe de busca do Gmail: is:unread, from:x, subject:y...). */
export async function gmailSearch(token: string, query: string, max = 8): Promise<{ total: number; items: MailItem[] }> {
  const auth = { Authorization: `Bearer ${token}` };
  const q = (query || 'in:inbox').slice(0, 200);
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`, { headers: auth, signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  if (list?.error) throw new Error(`Gmail: ${list.error.message ?? 'erro'}`);
  const ids: string[] = (list?.messages ?? []).map((m: any) => m.id);
  const metas = await Promise.all(ids.map((id) =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null)
  ));
  return {
    total: Number(list?.resultSizeEstimate ?? ids.length),
    items: metas.filter(Boolean).map((m: any) => ({
      from: hdr(m, 'from').slice(0, 80), subject: hdr(m, 'subject').slice(0, 120), date: hdr(m, 'date').slice(0, 40),
      snippet: String(m.snippet ?? '').slice(0, 180), unread: (m.labelIds ?? []).includes('UNREAD')
    }))
  };
}

export interface EventItem { title: string; start: string; end: string; where: string }

export async function calendarEvents(token: string, days = 7): Promise<EventItem[]> {
  const min = new Date().toISOString();
  const max = new Date(Date.now() + days * 24 * 3600_000).toISOString();
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=15`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
  ).then((x) => x.json());
  if (r?.error) throw new Error(`Agenda: ${r.error.message ?? 'erro'}`);
  return (r?.items ?? []).map((e: any) => ({
    title: String(e.summary ?? 'Sem título').slice(0, 100),
    start: e.start?.dateTime ?? e.start?.date ?? '', end: e.end?.dateTime ?? e.end?.date ?? '', where: String(e.location ?? '').slice(0, 80)
  }));
}

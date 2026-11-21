import { admin, handle, json, cleanDomain } from '../_shared/common.ts';
import { encryptSecret } from '../_shared/crypto.ts';

// Nenhuma ação devolve a senha: ela só é decifrada dentro de `handoff-browser`, para o navegador.
Deno.serve(handle(async (b) => {
  const db = admin();

  if (b.action === 'list') {
    const { data } = await db
      .from('credential_vault')
      .select('id, site_name, domain, login_url, username, auto_login, last_used_at, created_at')
      .order('created_at', { ascending: false });
    return json({ credentials: data ?? [] });
  }

  if (b.action === 'save') {
    const domain = cleanDomain(b.domain);
    if (!b.siteName || !domain || !b.username || !b.password) return json({ error: 'Preencha site, domínio, login e senha' }, 400);
    const { encrypted, iv } = await encryptSecret(String(b.password));
    const { data, error } = await db
      .from('credential_vault')
      .insert({
        site_name: String(b.siteName).slice(0, 80), domain, login_url: String(b.loginUrl || `https://${domain}`).slice(0, 300),
        username: String(b.username).slice(0, 200), encrypted_password: encrypted, iv, auto_login: true
      })
      .select('id, site_name, domain, username, auto_login')
      .single();
    if (error) throw error;
    return json({ saved: data });
  }

  if (b.action === 'delete') {
    await db.from('credential_vault').delete().eq('id', String(b.id));
    return json({ deleted: true });
  }

  return json({ error: 'Ação inválida' }, 400);
}));

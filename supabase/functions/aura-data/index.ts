import { admin, handle, json, fileRowToClient } from '../_shared/common.ts';
import { embed } from '../_shared/gemini.ts';

const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

Deno.serve(handle(async (b) => {
  const db = admin();

  switch (b.action) {
    case 'bootstrap': {
      const [mem, proj, pf, msgs, panels, rules, files, settings, chat] = await Promise.all([
        db.from('memories').select('id, tag, content').order('created_at', { ascending: false }).limit(200),
        db.from('projects').select('id, title, description').order('created_at', { ascending: false }),
        db.from('project_files').select('project_id, file_name'),
        db.from('messages').select('project_id, role, content').not('project_id', 'is', null).order('created_at', { ascending: true }).limit(500),
        db.from('panels').select('id, title, panel_type, state_json').order('updated_at', { ascending: true }),
        db.from('autonomy_rules').select('category, mode'),
        db.from('user_files').select('*').order('updated_at', { ascending: false }),
        db.from('app_settings').select('key, value'),
        db.from('messages').select('id, role, content').is('project_id', null).order('created_at', { ascending: false }).limit(60)
      ]);
      const projects = (proj.data ?? []).map((p: any) => ({
        id: p.id, title: p.title, desc: p.description ?? '',
        files: (pf.data ?? []).filter((f: any) => f.project_id === p.id).map((f: any) => f.file_name),
        messages: (msgs.data ?? []).filter((m: any) => m.project_id === p.id).map((m: any) => ({ role: m.role, text: m.content }))
      }));
      return json({
        memories: (mem.data ?? []).map((m: any) => ({ id: m.id, tag: m.tag, text: m.content })),
        projects,
        panels: (panels.data ?? []).map((p: any) => ({ id: p.id, title: p.title, type: p.panel_type, state: p.state_json })),
        autonomy: rules.data ?? [],
        files: (files.data ?? []).map(fileRowToClient),
        settings: Object.fromEntries((settings.data ?? []).map((s: any) => [s.key, s.value])),
        chat: (chat.data ?? []).reverse().map((m: any) => ({ id: m.id, role: m.role, text: m.content }))
      });
    }

    case 'memory_add': {
      const m = b.memory;
      const text = String(m?.text || '').slice(0, 500);
      if (!isUuid(m?.id) || !text) return json({ error: 'Memória inválida' }, 400);
      const embedding = await embed(text, 'RETRIEVAL_DOCUMENT'); // null se Gemini indisponível: ainda salva
      const { error } = await db.from('memories').upsert({ id: m.id, tag: String(m.tag || 'Manual').slice(0, 40), content: text, embedding });
      if (error) throw error;
      return json({ ok: true, embedded: Boolean(embedding) });
    }
    case 'memory_delete': {
      if (!isUuid(b.id)) return json({ error: 'id inválido' }, 400);
      await db.from('memories').delete().eq('id', b.id);
      return json({ ok: true });
    }

    case 'project_create': {
      const p = b.project;
      if (!isUuid(p?.id) || !p?.title) return json({ error: 'Projeto inválido' }, 400);
      const { error } = await db.from('projects').upsert({ id: p.id, title: String(p.title).slice(0, 120), description: String(p.desc || '').slice(0, 500) });
      if (error) throw error;
      return json({ ok: true });
    }
    case 'project_add_file': {
      if (!isUuid(b.projectId)) return json({ error: 'projectId inválido' }, 400);
      const { error } = await db.from('project_files').upsert(
        { project_id: b.projectId, file_name: String(b.fileName), storage_path: String(b.storagePath) },
        { onConflict: 'project_id,file_name' }
      );
      if (error) throw error;
      return json({ ok: true });
    }

    case 'panel_save': {
      const p = b.panel;
      if (!isUuid(p?.id) || !p?.title || !p?.type) return json({ error: 'Painel inválido' }, 400);
      const { error } = await db.from('panels').upsert({
        id: p.id, title: String(p.title).slice(0, 120), panel_type: p.type, state_json: p.state ?? {}, updated_at: new Date().toISOString()
      });
      if (error) throw error;
      return json({ ok: true });
    }
    case 'panel_delete': {
      if (!isUuid(b.id)) return json({ error: 'id inválido' }, 400);
      await db.from('panels').delete().eq('id', b.id);
      return json({ ok: true });
    }

    case 'autonomy_set': {
      if (!['auto', 'ask_approval'].includes(b.mode)) return json({ error: 'modo inválido' }, 400);
      const { error } = await db.from('autonomy_rules').upsert(
        { category: String(b.category), mode: b.mode, updated_at: new Date().toISOString() }, { onConflict: 'category' }
      );
      if (error) throw error;
      return json({ ok: true });
    }

    case 'chat_append': {
      // Resultado do navegador (ou aviso) entra no histórico para a IA lembrar nas próximas mensagens.
      const text = String(b.text || '').slice(0, 4000);
      if (!text) return json({ error: 'texto vazio' }, 400);
      const { error } = await db.from('messages').insert({ project_id: null, role: 'assistant', content: text, metadata: { source: 'browser' } });
      if (error) throw error;
      return json({ ok: true });
    }

    case 'setting_set': {
      if (!['cv_base_text'].includes(b.key)) return json({ error: 'chave não permitida' }, 400);
      const { error } = await db.from('app_settings').upsert({ key: b.key, value: b.value, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true });
    }

    default:
      return json({ error: 'Ação inválida' }, 400);
  }
}));

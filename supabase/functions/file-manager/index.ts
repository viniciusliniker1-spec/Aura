import { admin, handle, json } from '../_shared/common.ts';
import { generate } from '../_shared/gemini.ts';
import { buildPdf, buildDocx } from '../_shared/docs.ts';

const BUCKET = 'aura-files';
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100);
const guessCategory = (name: string) => (/curr|cv|resume/i.test(name) ? 'curriculo' : /comprov|recibo|fatura/i.test(name) ? 'comprovante' : 'documento');

Deno.serve(handle(async (b) => {
  const db = admin();

  // 1. Upload direto do app para o Storage via URL assinada (o bucket é privado)
  if (b.action === 'upload_url') {
    if (!b.fileName) return json({ error: 'fileName obrigatório' }, 400);
    const path = `${crypto.randomUUID()}/${safeName(String(b.fileName))}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    return json({ path: data.path, token: data.token });
  }

  // 2. Registra o arquivo (já enviado) na tabela user_files
  if (b.action === 'register') {
    const ext = String(b.ext || String(b.fileName).split('.').pop() || 'bin').toLowerCase().slice(0, 10);
    const { data, error } = await db.from('user_files').insert({
      file_name: String(b.fileName).slice(0, 200), file_ext: ext, mime_type: String(b.mime || 'application/octet-stream'),
      size_bytes: Number(b.size) || 0, category: guessCategory(String(b.fileName)), storage_path: String(b.path)
    }).select('*').single();
    if (error) throw error;
    return json({ file: data });
  }

  if (b.action === 'delete') {
    const { data: row } = await db.from('user_files').select('storage_path').eq('id', String(b.id)).maybeSingle();
    if (row?.storage_path) await db.storage.from(BUCKET).remove([row.storage_path]);
    await db.from('user_files').delete().eq('id', String(b.id));
    return json({ deleted: true });
  }

  if (b.action === 'signed_url') {
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(String(b.storagePath), 600);
    if (error) throw error;
    return json({ signedUrl: data.signedUrl });
  }

  // 3. Atualizador de currículo com IA -> gera PDF ou DOCX de verdade e salva no Storage
  if (b.action === 'tailor_cv') {
    const format: 'pdf' | 'docx' = b.format === 'docx' ? 'docx' : 'pdf';
    const targetRole = String(b.targetRole || '').slice(0, 200);
    if (!targetRole) return json({ error: 'Informe a vaga ou foco' }, 400);

    let base = String(b.currentCvText || '');
    if (!base.trim()) {
      const { data: s } = await db.from('app_settings').select('value').eq('key', 'cv_base_text').maybeSingle();
      base = typeof s?.value === 'string' ? s.value : '';
    }
    if (base.trim().length < 80) return json({ error: 'Cole o texto base do seu currículo em Arquivos & Currículo antes de gerar.' }, 400);

    const markdown = await generate({
      system: 'Você é um revisor de currículos. Mantenha TODOS os fatos reais; nunca invente experiências, cargos, datas, métricas ou formações. Reordene e reescreva para destacar o que é mais relevante para a vaga. Saída: Markdown limpo (# Nome, ## Seções, - bullets, **negrito** pontual), em português, sem comentários fora do currículo.',
      quality: true,
      contents: [{ role: 'user', parts: [{ text: `Vaga/objetivo: "${targetRole}"\n\nCurrículo base:\n${base.slice(0, 12000)}` }] }]
    });
    if (!markdown.trim()) throw new Error('A IA não devolveu conteúdo');

    const bytes = format === 'pdf' ? await buildPdf(markdown) : await buildDocx(markdown);
    const slug = safeName(targetRole).slice(0, 24) || 'Vaga';
    const fileName = `CV_${slug}_${new Date().getFullYear()}.${format}`;
    const path = `${crypto.randomUUID()}/${fileName}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[format], upsert: false });
    if (upErr) throw upErr;

    const { count } = await db.from('user_files').select('id', { count: 'exact', head: true }).eq('category', 'curriculo');
    const { data, error } = await db.from('user_files').insert({
      file_name: fileName, file_ext: format, mime_type: MIME[format], size_bytes: bytes.length,
      category: 'curriculo', storage_path: path, version: (count ?? 0) + 1, notes: `Adaptado para: ${targetRole}`
    }).select('*').single();
    if (error) throw error;
    return json({ file: data, preview: markdown.slice(0, 600) });
  }

  return json({ error: 'Ação inválida' }, 400);
}));

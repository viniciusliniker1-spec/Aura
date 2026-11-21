import { admin, handle, json } from '../_shared/common.ts';
import { embed, generateJSON, mintLiveToken, lastCall, diagnose } from '../_shared/gemini.ts';

const PANEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    type: { type: 'STRING', enum: ['pomodoro', 'checklist'] },
    items: { type: 'ARRAY', items: { type: 'STRING' } },
    minutes: { type: 'INTEGER' }
  },
  required: ['title', 'type']
};

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    memoryToSave: { type: 'STRING' },
    handoff: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING' }, task: { type: 'STRING' }, fileName: { type: 'STRING' } },
      required: ['url', 'task']
    },
    panel: PANEL_SCHEMA,
    cvRequest: {
      type: 'OBJECT',
      properties: { role: { type: 'STRING' }, format: { type: 'STRING', enum: ['pdf', 'docx'] } },
      required: ['role', 'format']
    }
  },
  required: ['reply']
};

Deno.serve(handle(async (body) => {
  const db = admin();

  if (body.action === 'diagnose') return json(await diagnose());

  if (body.action === 'live_token') {
    const token = await mintLiveToken();
    return json({ token, model: Deno.env.get('GEMINI_LIVE_MODEL') || 'gemini-3.8-live' });
  }

  if (body.action === 'generate_panel') {
    const panel = await generateJSON<any>({
      system: 'Você cria micro-apps ("painéis") para um assistente pessoal. Responda em português. Use type "pomodoro" para timers/foco e "checklist" para listas (3 a 8 itens curtos em "items").',
      contents: [{ role: 'user', parts: [{ text: String(body.prompt || '').slice(0, 500) }] }],
      schema: PANEL_SCHEMA
    });
    return json({ panel });
  }

  // ---- chat ----
  const message = String(body.message || '').trim().slice(0, 4000);
  if (!message) return json({ error: 'Mensagem vazia' }, 400);
  const projectId: string | null = body.projectId || null;

  // 1+2. Tudo em paralelo: embedding, histórico, arquivos e contexto do projeto (antes era em fila).
  const t0 = Date.now();
  let hq = db.from('messages').select('role, content').order('created_at', { ascending: false }).limit(8);
  hq = projectId ? hq.eq('project_id', projectId) : hq.is('project_id', null);
  const [qEmb, histRes, filesRes, projRes, pfRes] = await Promise.all([
    embed(message, 'RETRIEVAL_QUERY'),
    hq,
    db.from('user_files').select('file_name').order('updated_at', { ascending: false }).limit(30),
    projectId ? db.from('projects').select('title, description').eq('id', projectId).maybeSingle() : Promise.resolve({ data: null }),
    projectId ? db.from('project_files').select('file_name').eq('project_id', projectId) : Promise.resolve({ data: [] })
  ]);
  let memoryContext = '';
  if (qEmb) {
    const { data: matched } = await db.rpc('match_memories', { query_embedding: qEmb, match_threshold: 0.55, match_count: 6 });
    if (matched?.length) memoryContext = matched.map((m: any) => `- [${m.tag}] ${m.content}`).join('\n');
  }
  const proj = (projRes as any).data;
  const projectContext = proj
    ? `Projeto atual: "${proj.title}" — ${proj.description ?? ''}\nArquivos vinculados: ${((pfRes as any).data ?? []).map((f: any) => f.file_name).join(', ') || 'nenhum'}`
    : '';
  const history = ((histRes as any).data ?? []).reverse().map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user' as 'user' | 'model',
    parts: [{ text: String(m.content) }]
  }));
  const fileNames = ((filesRes as any).data ?? []).map((f: any) => f.file_name);
  const tCtx = Date.now() - t0;

  const system = `Você é o Aura, assistente pessoal proativo (uso individual). Converse em português do Brasil, de forma natural, curta e útil.

Memórias relevantes do usuário:
${memoryContext || '(nenhuma)'}
${projectContext}
Arquivos no Cofre: ${fileNames.join(', ') || 'nenhum'}

VOCÊ DECIDE quando usar o navegador, lendo o contexto da conversa inteira (não só a última frase).
Preencha "handoff" quando a resposta ou a tarefa EXIGIR a web ou um site:
- informação atual que você não tem como saber (vagas abertas, preços, cotações, notícias, status de pedido, prazos, horários);
- operar uma conta ou site do usuário (LinkedIn, Gupy, Catho, banco, portais, compras, reservas, órgãos públicos);
- continuar uma tarefa de navegador já em andamento na conversa (ex.: "pode enviar", "e a segunda vaga?").
NÃO use handoff para: conversa, opinião, explicações, redação, resumos, contas, ou qualquer coisa que você já sabe responder bem. Na dúvida entre responder e navegar, responda. NÃO pergunte o que você mesmo descobre no site (ex.: no LinkedIn use as vagas recomendadas do perfil). Só pergunte quando faltar um dado que apenas o usuário tem; nesse caso faça a pergunta e NÃO preencha handoff nesta resposta — navegue só depois que ele responder.
Ao usar handoff: "task" = objetivo claro e verificável em português, com o que devolver (ex.: "listar as 5 primeiras vagas de Produto em SP com título, empresa e link"); "url" = o site mais adequado (ou google.com para pesquisa aberta); "fileName" só se precisar anexar um arquivo do Cofre. No "reply", diga em 1 frase o que vai fazer; o resultado volta para a conversa sozinho depois. O navegador PARA antes de qualquer envio final (candidatura, mensagem, pagamento) e pede aprovação. Nunca peça nem escreva senhas: o Cofre as injeta sem expô-las.

Outros campos, só quando o usuário pedir claramente:
- memoryToSave: fato permanente a lembrar.
- panel {title,type,items,minutes}: painel/micro-app.
- cvRequest {role,format}: adaptar o currículo para uma vaga (pdf ou docx).
Se mensagens anteriores trouxerem resultados do navegador, use-os para responder.`;

  const t1 = Date.now();
  const out = await generateJSON<any>({
    system,
    contents: [...history, { role: 'user', parts: [{ text: message }] }],
    schema: CHAT_SCHEMA
  });

  const result: Record<string, unknown> = { reply: String(out.reply || 'Pronto!') };

  // 3. Efeitos colaterais
  if (out.memoryToSave) {
    const fact = String(out.memoryToSave).slice(0, 500);
    const emb = await embed(fact, 'RETRIEVAL_DOCUMENT');
    const { data: mem } = await db.from('memories').insert({ tag: 'IA', content: fact, embedding: emb }).select('id').single();
    result.memorySaved = fact;
    if (mem) result.memoryId = mem.id;
  }
  if (out.handoff?.url) {
    result.handoff = {
      url: String(out.handoff.url).slice(0, 300),
      task: String(out.handoff.task || message).slice(0, 500),
      fileName: out.handoff.fileName && fileNames.includes(out.handoff.fileName) ? out.handoff.fileName : null
    };
  }
  if (out.panel?.title) result.panel = out.panel;
  if (out.cvRequest?.role) result.cvRequest = out.cvRequest;

  // Grava o histórico DEPOIS de responder (não faz o usuário esperar).
  const save = db.from('messages').insert([
    { project_id: projectId, role: 'user', content: message },
    { project_id: projectId, role: 'assistant', content: result.reply as string, metadata: { handoff: result.handoff ?? null } }
  ]).then(({ error }: { error: unknown }) => { if (error) console.warn('historico:', error); });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(save); else await save;

  result.timing = { ctx: tCtx, llm: Date.now() - t1, model: lastCall.model };
  console.log(`aura-chat: contexto ${tCtx}ms, LLM ${Date.now() - t1}ms, total ${Date.now() - t0}ms`);
  return json(result);
}));

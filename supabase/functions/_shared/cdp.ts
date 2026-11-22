// Cliente mínimo do Chrome DevTools Protocol (CDP) sobre WebSocket: o suficiente para um agente operar um navegador
// remoto (screenshot, clique, digitação, rolagem, navegação). Sem Playwright: roda no Edge Function (Deno).

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 }, esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }, delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' }, ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 }, pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  home: { key: 'Home', code: 'Home', vk: 36 }, end: { key: 'End', code: 'End', vk: 35 }
};
const MODS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };

export class Cdp {
  private ws!: WebSocket;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private sessionId: string | undefined;

  static async connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
    const c = new Cdp();
    c.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP: tempo esgotado ao conectar')), timeoutMs);
      c.ws.onopen = () => { clearTimeout(t); resolve(); };
      c.ws.onerror = () => { clearTimeout(t); reject(new Error('CDP: falha ao conectar no navegador')); };
    });
    c.ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      const p = m.id !== undefined ? c.pending.get(m.id) : undefined;
      if (!p) return;
      c.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(`CDP ${m.error.message ?? 'erro'}`)); else p.resolve(m.result);
    };
    c.ws.onclose = () => {
      for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP: conexão fechada')); }
      c.pending.clear();
    };
    return c;
  }

  close() { try { this.ws.close(); } catch { /* já fechado */ } }

  send(method: string, params: Record<string, unknown> = {}, opts: { session?: boolean; timeoutMs?: number } = {}): Promise<any> {
    const id = ++this.seq;
    const msg: Record<string, unknown> = { id, method, params };
    if (opts.session !== false && this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method}: tempo esgotado`)); }, opts.timeoutMs ?? 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  /** Conecta na primeira aba (ou cria uma). Se a URL já é de uma aba (não do navegador), usa direto. */
  async attachPage(): Promise<void> {
    let targets: any[];
    try {
      targets = (await this.send('Target.getTargets', {}, { session: false })).targetInfos ?? [];
    } catch {
      return; // endpoint de aba: comandos vão direto, sem sessão
    }
    let page = targets.find((t) => t.type === 'page' && !String(t.url).startsWith('chrome-extension://') && !String(t.url).startsWith('devtools://'));
    if (!page) {
      const created = await this.send('Target.createTarget', { url: 'about:blank' }, { session: false });
      page = { targetId: created.targetId };
    }
    const att = await this.send('Target.attachToTarget', { targetId: page.targetId, flatten: true }, { session: false });
    this.sessionId = att.sessionId;
    await this.send('Page.enable').catch(() => null);
    await this.send('Target.activateTarget', { targetId: page.targetId }, { session: false }).catch(() => null);
  }

  /** Visão de celular (só tem efeito se o navegador permitir emulação). Melhor esforço. */
  async emulateMobile(width = 412, height = 915): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true }).catch(() => null);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true }).catch(() => null);
  }

  async viewport(): Promise<{ w: number; h: number }> {
    const r = await this.send('Runtime.evaluate', { expression: 'JSON.stringify([window.innerWidth, window.innerHeight])', returnByValue: true });
    const [w, h] = JSON.parse(r.result.value);
    return { w, h };
  }

  async info(): Promise<{ url: string; title: string }> {
    const r = await this.send('Runtime.evaluate', { expression: 'JSON.stringify([location.href, document.title])', returnByValue: true });
    const [url, title] = JSON.parse(r.result.value);
    return { url, title };
  }

  /** Captura da página (JPEG) com o tamanho do viewport em px CSS. */
  async screenshot(quality = 55): Promise<{ b64: string; w: number; h: number; url: string }> {
    const { w, h } = await this.viewport();
    // scale:1 => 1 px de imagem por px CSS (sem dobrar por causa da densidade da tela): menos tokens e passos mais rápidos.
    const [shot, info] = await Promise.all([
      this.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }),
      this.info()
    ]);
    return { b64: shot.data, w, h, url: info.url };
  }

  async waitLoaded(maxMs = 8000): Promise<void> {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      try {
        const r = await this.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, { timeoutMs: 3000 });
        if (r.result.value === 'complete') return;
      } catch { /* página trocando */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async click(x: number, y: number, opts: { button?: 'left' | 'right' | 'middle'; count?: number } = {}) {
    const button = opts.button ?? 'left';
    const count = opts.count ?? 1;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (let i = 1; i <= count; i++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i });
    }
  }

  async hover(x: number, y: number) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }

  async typeText(text: string) { if (text) await this.send('Input.insertText', { text }); }

  private async key(down: boolean, k: { key: string; code: string; vk: number; text?: string }, modifiers = 0) {
    await this.send('Input.dispatchKeyEvent', {
      type: down ? (k.text && !modifiers ? 'keyDown' : 'rawKeyDown') : 'keyUp', modifiers,
      key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
      ...(down && k.text && !modifiers ? { text: k.text } : {})
    });
  }

  /** "Enter", "Control+A", "Shift+Tab"… */
  async press(combo: string) {
    const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
    const main = parts.pop() ?? '';
    let modifiers = 0;
    for (const p of parts) modifiers |= MODS[p.toLowerCase()] ?? 0;
    const lower = main.toLowerCase();
    const known = KEYS[lower];
    const k = known ?? (main.length === 1
      ? { key: main, code: /[a-z]/i.test(main) ? `Key${main.toUpperCase()}` : '', vk: main.toUpperCase().charCodeAt(0), text: main }
      : { key: main, code: main, vk: 0 });
    // Atalhos de edição só funcionam via "commands" no Chrome headless
    const cmd = modifiers & (2 | 4) && main.length === 1 ? ({ a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' } as Record<string, string>)[lower] : undefined;
    if (cmd) {
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, commands: [cmd] });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
      return;
    }
    await this.key(true, k, modifiers);
    await this.key(false, k, modifiers);
  }

  async scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount = 400) {
    const dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
    const dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
  }

  async navigate(url: string) {
    const full = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    await this.send('Page.navigate', { url: full }, { timeoutMs: 20_000 });
    await this.waitLoaded();
  }

  async history(delta: -1 | 1) {
    const h = await this.send('Page.getNavigationHistory');
    const e = h.entries[h.currentIndex + delta];
    if (e) { await this.send('Page.navigateToHistoryEntry', { entryId: e.id }); await this.waitLoaded(); }
  }

  async drag(x1: number, y1: number, x2: number, y2: number) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, buttons: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
  }
}

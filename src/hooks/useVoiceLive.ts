import { useState, useRef, useCallback, useEffect } from 'react';
import { chat } from '../lib/api';

export type VoiceMode = 'gemini-live' | 'web-speech' | 'unavailable';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecCtor = new () => SpeechRecognitionLike;

const LIVE_WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

function floatTo16kPcmBase64(input: Float32Array): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Voz Live: tenta Gemini Live API (WebSocket + token efêmero emitido pela Edge Function `aura-chat`)
 * e cai automaticamente para a Web Speech API do navegador/WebView.
 * O texto final reconhecido vira uma mensagem normal do chat.
 */
export function useVoiceLive(onFinalTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Toque no microfone para falar');
  const [mode, setMode] = useState<VoiceMode>('unavailable');

  const cbRef = useRef(onFinalTranscript);
  cbRef.current = onFinalTranscript;
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; proc: ScriptProcessorNode } | null>(null);
  const finalTextRef = useRef('');
  const activeRef = useRef(false);

  const cleanup = useCallback(() => {
    activeRef.current = false;
    setIsListening(false);
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    const a = audioRef.current;
    if (a) {
      try { a.proc.disconnect(); a.stream.getTracks().forEach((t) => t.stop()); void a.ctx.close(); } catch { /* noop */ }
    }
    audioRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback((text: string) => {
    const clean = text.trim();
    cleanup();
    if (clean) cbRef.current(clean);
  }, [cleanup]);

  const startWebSpeech = useCallback((): boolean => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;
    try {
      const rec = new Ctor();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0].transcript).join('');
        setTranscript(text);
        finalTextRef.current = text;
        if (e.results[e.results.length - 1]?.isFinal) finish(text);
      };
      rec.onerror = (e) => {
        setStatus(e.error === 'not-allowed' ? 'Permita o microfone para usar a voz' : 'Não consegui ouvir — use um comando abaixo');
        cleanup();
      };
      rec.onend = () => {
        if (activeRef.current) finish(finalTextRef.current);
      };
      recRef.current = rec;
      activeRef.current = true;
      rec.start();
      setMode('web-speech');
      setIsListening(true);
      setStatus('Estou ouvindo…');
      return true;
    } catch {
      return false;
    }
  }, [cleanup, finish]);

  const startGeminiLive = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const tok = await chat.liveToken();
    if (!tok?.token) return false;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    const ws = new WebSocket(`${LIVE_WS}?access_token=${encodeURIComponent(tok.token)}`);
    wsRef.current = ws;
    finalTextRef.current = '';

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 6000);
    });
    if (!opened) {
      stream.getTracks().forEach((t) => t.stop());
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
      return false;
    }

    ws.send(JSON.stringify({
      setup: {
        model: `models/${tok.model || 'gemini-live-2.5-flash-preview'}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        inputAudioTranscription: {}
      }
    }));

    ws.onmessage = async (ev) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
        const msg = JSON.parse(raw) as {
          serverContent?: { inputTranscription?: { text?: string }; turnComplete?: boolean };
        };
        const t = msg.serverContent?.inputTranscription?.text;
        if (t) {
          finalTextRef.current += t;
          setTranscript(finalTextRef.current);
        }
        if (msg.serverContent?.turnComplete && finalTextRef.current.trim()) finish(finalTextRef.current);
      } catch { /* mensagem ignorada */ }
    };
    ws.onclose = () => { if (activeRef.current) finish(finalTextRef.current); };

    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        realtimeInput: { audio: { data: floatTo16kPcmBase64(e.inputBuffer.getChannelData(0)), mimeType: 'audio/pcm;rate=16000' } }
      }));
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    audioRef.current = { ctx, stream, proc };
    activeRef.current = true;
    setMode('gemini-live');
    setIsListening(true);
    setStatus('Estou ouvindo… (Gemini Live)');
    return true;
  }, [finish]);

  const start = useCallback(async () => {
    cleanup();
    setTranscript('');
    finalTextRef.current = '';
    setStatus('Conectando…');
    try {
      if (await startGeminiLive()) return;
    } catch {
      cleanup();
    }
    if (startWebSpeech()) return;
    setMode('unavailable');
    setStatus('Voz indisponível neste dispositivo — use um comando abaixo');
  }, [cleanup, startGeminiLive, startWebSpeech]);

  /** Encerra a captura enviando o que já foi ouvido (botão "parar"). */
  const commit = useCallback(() => finish(finalTextRef.current), [finish]);

  return { isListening, transcript, status, mode, start, stop: cleanup, commit };
}

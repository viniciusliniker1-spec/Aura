import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'npm:docx@8.5.0';

type Block = { kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'p' | 'gap'; text: string };

export function parseMarkdown(md: string): Block[] {
  return md.replace(/\r/g, '').split('\n').map((raw): Block => {
    const l = raw.trimEnd();
    if (!l.trim()) return { kind: 'gap', text: '' };
    if (/^#\s/.test(l)) return { kind: 'h1', text: l.replace(/^#\s+/, '') };
    if (/^##\s/.test(l)) return { kind: 'h2', text: l.replace(/^##\s+/, '') };
    if (/^#{3,}\s/.test(l)) return { kind: 'h3', text: l.replace(/^#{3,}\s+/, '') };
    if (/^\s*[-*•]\s+/.test(l)) return { kind: 'bullet', text: l.replace(/^\s*[-*•]\s+/, '') };
    return { kind: 'p', text: l };
  });
}

const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`]/g, '');
// Helvetica padrão só codifica WinAnsi: troca o que não cabe por '?'.
const winAnsi = (s: string) => Array.from(s).map((c) => (c.charCodeAt(0) <= 0xff || '–—•‘’“”…€'.includes(c) ? c : '?')).join('');

export async function buildPdf(md: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 54;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (need: number) => { if (y - need < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const write = (text: string, f: typeof font, size: number, indent = 0, color = rgb(0.1, 0.1, 0.12)) => {
    const maxW = W - 2 * M - indent;
    const words = winAnsi(plain(text)).split(/\s+/);
    let line = '';
    const flush = () => { ensure(size * 1.4); page.drawText(line, { x: M + indent, y: y - size, size, font: f, color }); y -= size * 1.4; line = ''; };
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && line) { flush(); line = w; } else line = t;
    }
    if (line) flush();
  };

  for (const b of parseMarkdown(md)) {
    if (b.kind === 'gap') { y -= 6; continue; }
    if (b.kind === 'h1') { y -= 4; write(b.text, bold, 18); y -= 4; }
    else if (b.kind === 'h2') { y -= 8; write(b.text.toUpperCase(), bold, 11.5, 0, rgb(0.04, 0.34, 0.64)); y -= 2; }
    else if (b.kind === 'h3') write(b.text, bold, 10.5);
    else if (b.kind === 'bullet') { ensure(14); page.drawText('•', { x: M + 4, y: y - 10.5, size: 10.5, font }); write(b.text, font, 10.5, 16); }
    else write(b.text, font, 10.5);
  }
  return await pdf.save();
}

function runs(text: string): TextRun[] {
  return text.split(/(\*\*.+?\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith('**') && part.endsWith('**')
      ? new TextRun({ text: part.slice(2, -2), bold: true })
      : new TextRun({ text: part.replace(/[*_`]/g, '') })
  );
}

export async function buildDocx(md: string): Promise<Uint8Array> {
  const children: Paragraph[] = parseMarkdown(md).map((b) => {
    switch (b.kind) {
      case 'h1': return new Paragraph({ heading: HeadingLevel.TITLE, children: runs(b.text) });
      case 'h2': return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200 }, children: runs(b.text) });
      case 'h3': return new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(b.text) });
      case 'bullet': return new Paragraph({ bullet: { level: 0 }, children: runs(b.text) });
      case 'gap': return new Paragraph({ children: [] });
      default: return new Paragraph({ children: runs(b.text) });
    }
  });
  const buf = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return new Uint8Array(buf);
}

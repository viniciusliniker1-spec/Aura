// Aplica as permissões nativas que a Voz Live precisa (idempotente). Rode depois de `npx cap add android|ios`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const log = (m) => console.log(`[patch-native] ${m}`);

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  const perms = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'];
  let changed = false;
  for (const p of perms) {
    if (!x.includes(p)) {
      x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
      changed = true;
    }
  }
  if (changed) { writeFileSync(manifest, x); log('Android: permissões de microfone adicionadas.'); }
  else log('Android: já configurado.');
} else log('Android: pasta não encontrada (rode `npx cap add android`).');

const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let x = readFileSync(plist, 'utf8');
  const add = {
    NSMicrophoneUsageDescription: 'O Aura usa o microfone para o modo Voz Live.',
    NSSpeechRecognitionUsageDescription: 'O Aura reconhece sua fala para transformar voz em comandos.'
  };
  let changed = false;
  for (const [k, v] of Object.entries(add)) {
    if (!x.includes(`<key>${k}</key>`)) {
      x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t<string>${v}</string>\n</dict>\n</plist>\n`);
      changed = true;
    }
  }
  if (changed) { writeFileSync(plist, x); log('iOS: permissões de microfone/fala adicionadas.'); }
  else log('iOS: já configurado.');
} else log('iOS: pasta não encontrada (rode `npx cap add ios` no Mac).');

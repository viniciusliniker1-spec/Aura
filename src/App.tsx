import React, { useEffect, useRef, useState, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
import { AuraProvider, useAura } from './state/AuraContext';
import { useVoiceLive } from './hooks/useVoiceLive';
import { TopBar, Composer, QuickSheet, ProjectModal, VoiceOverlay, Toast } from './components/Shell';
import { InicioView, ChatView, ProjetosView } from './views/Tabs';
import { MenuView } from './views/Menu';
import { SubviewHost } from './views/Subviews';

const Screen: React.FC = () => {
  const { tab, subview, sendMessage, closeSubview, setTab, ready } = useAura();
  const [quick, setQuick] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [projModal, setProjModal] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const voice = useVoiceLive(useCallback((text: string) => { setVoiceOpen(false); void sendMessage(text); }, [sendMessage]));

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [tab, subview]);

  // Botão "voltar" do Android: fecha subview/menu antes de sair do app.
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      if (subview) closeSubview();
      else if (tab !== 'inicio') setTab('inicio');
      else void CapApp.exitApp();
    });
    return () => { void sub.then((s) => s.remove()); };
  }, [subview, tab, closeSubview, setTab]);

  const showComposer = !subview && (tab === 'inicio' || tab === 'chat');

  return (
    <div className="relative w-full sm:max-w-[412px] h-full sm:h-[852px] sm:max-h-[93vh] aura-backdrop sm:rounded-[38px] sm:shadow-2xl sm:shadow-black/75 sm:border sm:border-white/15 flex flex-col overflow-hidden">
      <TopBar onQuick={() => setQuick(true)} onNewProject={() => setProjModal(true)} />
      <main ref={mainRef} className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-28 space-y-3.5">
        {!ready ? (
          <p className="pt-16 text-center font-serif text-2xl text-white/80">aura</p>
        ) : subview ? <SubviewHost />
          : tab === 'inicio' ? <InicioView />
          : tab === 'chat' ? <ChatView />
          : tab === 'projetos' ? <ProjetosView onNew={() => setProjModal(true)} />
          : <MenuView />}
      </main>
      {showComposer && <Composer onQuick={() => setQuick(true)} onVoice={() => setVoiceOpen(true)} />}
      <QuickSheet open={quick} onClose={() => setQuick(false)} />
      <ProjectModal open={projModal} onClose={() => setProjModal(false)} />
      <VoiceOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} voice={voice} />
      <Toast />
    </div>
  );
};

export default function App() {
  return (
    <AuraProvider>
      <div className="h-full w-full flex items-center justify-center sm:p-4 bg-[#13161F]">
        <Screen />
      </div>
    </AuraProvider>
  );
}

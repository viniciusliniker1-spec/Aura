export type TabId = 'inicio' | 'chat' | 'projetos' | 'menu';
export type SubviewId = 'browser' | 'vault' | 'files' | 'panels' | 'memory' | 'autonomy' | 'diagnostics';

export interface MemoryItem {
  id: string;
  tag: string;
  text: string;
}

export interface ProactiveCard {
  id: string;
  verb: string;
  text: string;
  badge: string;
  badgeBg: string;
  url: string;
  file?: string | null;
  source: string;
}

export type ChatItem =
  | { id: string; role: 'user' | 'assistant'; text: string; meta?: string }
  | { id: string; role: 'handoff_card'; title: string; domain: string; task: string; file?: string | null }
  | { id: string; role: 'divider'; text: string };

export interface ProjectMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ProjectItem {
  id: string;
  title: string;
  desc: string;
  files: string[];
  messages: ProjectMessage[];
}

export interface CredentialItem {
  id: string;
  siteName: string;
  domain: string;
  username: string;
  /** Só existe no modo local (sem Supabase). Com o backend, a senha nunca volta ao app. */
  pass?: string;
}

export interface StoredFile {
  id: string;
  name: string;
  ext: string;
  size: string;
  version: number;
  storagePath?: string;
  category?: string;
}

export interface AutonomyRule {
  id: string; // = category no banco
  label: string;
  auto: boolean;
}

export type HandoffStatus =
  | 'running'
  | 'awaiting_approval'
  | 'takeover'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface HandoffState {
  id: string;
  remote: boolean;
  url: string;
  task: string;
  fileName: string | null;
  fileId: string | null;
  credUsed: string;
  status: HandoffStatus;
  steps: string[];
  stepIndex: number;
  liveUrl: string | null;
  requireApproval: boolean;
  loginMode?: boolean;
  /** Sessão remota só é consultada depois que o servidor devolveu o ID real. */
  ready?: boolean;
  persistent?: boolean;
  profileWarning?: string | null;
  error?: string;
}

export interface HabitItem {
  id: string;
  label: string;
  done: boolean;
}
export interface ExpenseItem {
  id: string;
  title: string;
  amount: number;
}
export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export type PanelType = 'routine' | 'expenses' | 'pomodoro' | 'checklist';

export interface RoutineState { waterMl: number; waterGoal: number; habits: HabitItem[] }
export interface ExpensesState { items: ExpenseItem[]; weeklyCap: number }
export interface PomodoroState { minutes: number }
export interface ChecklistState { items: ChecklistItem[] }

export interface PanelItem {
  id: string;
  title: string;
  type: PanelType;
  state: RoutineState | ExpensesState | PomodoroState | ChecklistState;
}

export interface GeneratedPanelSpec {
  title: string;
  type: 'pomodoro' | 'checklist';
  items?: string[];
  minutes?: number;
}

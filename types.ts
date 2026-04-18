export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

export interface SpeechSettings {
  rate: number;   // 0.5 to 2.0
  pitch: number;  // 0.5 to 2.0
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  rate: 1.0,
  pitch: 1.0,
};

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoading: boolean;
  error: string | null;
  buffer: AudioBuffer | null;
}

export interface VoiceConfig {
  name: VoiceName;
  label: string;
  gender: 'Male' | 'Female';
  description: string;
}

export const AVAILABLE_VOICES: VoiceConfig[] = [
  { name: VoiceName.Puck, label: 'Puck', gender: 'Male', description: 'Deep, resonant, storytelling' },
  { name: VoiceName.Charon, label: 'Charon', gender: 'Male', description: 'Authoritative, clear, news-like' },
  { name: VoiceName.Kore, label: 'Kore', gender: 'Female', description: 'Soothing, calm, meditative' },
  { name: VoiceName.Fenrir, label: 'Fenrir', gender: 'Male', description: 'Energetic, fast-paced, conversational' },
  { name: VoiceName.Zephyr, label: 'Zephyr', gender: 'Female', description: 'Friendly, bright, helpful' },
];

// System voices detected at runtime
export let SYSTEM_VOICES: SpeechSynthesisVoice[] = [];

export function loadSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([]);
      return;
    }
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      SYSTEM_VOICES = voices;
      resolve(voices);
      return;
    }
    
    window.speechSynthesis.onvoiceschanged = () => {
      SYSTEM_VOICES = window.speechSynthesis.getVoices();
      resolve(SYSTEM_VOICES);
    };
  });
}

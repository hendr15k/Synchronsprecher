export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

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
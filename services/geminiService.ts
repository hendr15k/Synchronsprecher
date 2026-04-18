// Web Speech API based TTS - No API key required!
// Replaces Google Gemini API with browser-native SpeechSynthesis

import { VoiceName, SpeechSettings, DEFAULT_SPEECH_SETTINGS } from "../types";

// --- Voice Mapping (Web Speech API voices) ---
// Maps our voice names to preferred system voice patterns
const VOICE_PREFERENCES: Record<VoiceName, { lang: string; patterns: string[] }> = {
  [VoiceName.Puck]: { lang: 'en-US', patterns: ['Daniel', 'Google UK English Male', 'Microsoft David', 'Male'] },
  [VoiceName.Charon]: { lang: 'en-US', patterns: ['Alex', 'Google US English', 'Microsoft Mark', 'Male'] },
  [VoiceName.Kore]: { lang: 'en-US', patterns: ['Samantha', 'Google US English Female', 'Microsoft Zira', 'Female'] },
  [VoiceName.Fenrir]: { lang: 'en-US', patterns: ['Google UK English Male', 'Fred', 'Microsoft David', 'Male'] },
  [VoiceName.Zephyr]: { lang: 'en-US', patterns: ['Google UK English Female', 'Victoria', 'Microsoft Zira', 'Female'] },
};

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function getVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

// Load voices (async in some browsers)
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
}

function findBestVoice(preference: typeof VOICE_PREFERENCES[VoiceName]): SpeechSynthesisVoice | null {
  const voices = getVoices();
  if (voices.length === 0) return null;

  // Try each pattern in order
  for (const pattern of preference.patterns) {
    const match = voices.find(v => 
      v.name.toLowerCase().includes(pattern.toLowerCase()) && 
      v.lang.startsWith(preference.lang.split('-')[0])
    );
    if (match) return match;
  }

  // Fallback: any voice matching language
  const langMatch = voices.find(v => v.lang.startsWith('en'));
  return langMatch || voices[0] || null;
}

// --- Simple text segmentation (no AI needed) ---
function segmentText(text: string): Array<{ speaker: string; text: string }> {
  // Simple heuristic: split by paragraphs and detect dialogue
  const lines = text.split(/\n\s*\n/);
  const segments: Array<{ speaker: string; text: string }> = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Detect dialogue patterns: "Text" said Character
    const dialogueMatch = trimmed.match(/^["""'](.+?)["""']\s*(?:said|says|replied|asked|answered|whispered|shouted|exclaimed|cried|muttered|narrated|[A-Z][a-z]+\s+(?:said|says|replied|asked))/i);
    if (dialogueMatch) {
      // Extract character name if present
      const charMatch = trimmed.match(/(?:said|says|replied|asked|answered|whispered|shouted|exclaimed|cried|muttered)\s+([A-Z][a-z]+)/i);
      const speaker = charMatch ? charMatch[1] : 'Character';
      segments.push({ speaker, text: dialogueMatch[1] });
      
      // Add any remaining text as narrator
      const remaining = trimmed.replace(dialogueMatch[0], '').trim();
      if (remaining) {
        segments.push({ speaker: 'Narrator', text: remaining });
      }
    } else if (trimmed.startsWith('"') || trimmed.startsWith('"') || trimmed.startsWith("'")) {
      // Pure dialogue line
      segments.push({ speaker: 'Character', text: trimmed.replace(/^[""']|[""']$/g, '') });
    } else {
      // Narrator text
      segments.push({ speaker: 'Narrator', text: trimmed });
    }
  }

  // Merge consecutive same-speaker segments
  const merged: Array<{ speaker: string; text: string }> = [];
  for (const seg of segments) {
    if (merged.length > 0 && merged[merged.length - 1].speaker === seg.speaker) {
      merged[merged.length - 1].text += '\n\n' + seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.length > 0 ? merged : [{ speaker: 'Narrator', text }];
}

// --- Request Queue ---
class RequestQueue {
  private queue: Array<{ task: () => Promise<void>; reject: (reason?: any) => void }> = [];
  private isProcessing = false;

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task: async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });
      this.process();
    });
  }

  clear() {
    this.queue.forEach((item) => item.reject(new Error('Request cancelled')));
    this.queue = [];
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        await item.task();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.isProcessing = false;
  }
}

const apiQueue = new RequestQueue();

export function cancelGenerations() {
  apiQueue.clear();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// --- Generate Speech using Web Speech API ---
// Returns a Promise that resolves when speech is complete
// Since Web Speech API is real-time (no file), we use a different approach:
// We return immediately and use the SpeechSynthesis API directly in playback

let currentUtterance: SpeechSynthesisUtterance | null = null;
let speechResolve: (() => void) | null = null;
let isPaused = false;
let pausedResolve: (() => void) | null = null;
let currentSettings: SpeechSettings = DEFAULT_SPEECH_SETTINGS;

function speakText(text: string, voiceName: VoiceName): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Speech Synthesis not supported in this browser'));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const preference = VOICE_PREFERENCES[voiceName];
    const voice = findBestVoice(preference);
    
    if (voice) {
      utterance.voice = voice;
    }
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      currentUtterance = null;
      resolve();
    };
    utterance.onerror = (e) => {
      currentUtterance = null;
      reject(new Error(`Speech error: ${e.error}`));
    };

    currentUtterance = utterance;
    speechResolve = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

// --- Main Export ---
// Since Web Speech API is real-time and doesn't produce audio files,
// we need to adapt the architecture. We'll use a callback-based approach.

type SpeechCallback = (state: 'start' | 'end' | 'error', data?: any) => void;

export async function generateSpeech(
  text: string,
  voice: VoiceName,
  isMultiSpeaker: boolean = false
): Promise<string> {
  // Web Speech API doesn't return audio data - it speaks directly.
  // Return a special marker that App.tsx will handle differently.
  return JSON.stringify({
    type: 'web-speech',
    text,
    voice,
    isMultiSpeaker,
    timestamp: Date.now()
  });
}

// Direct speech playback (called from App.tsx)
export function speakWithWebSpeech(
  text: string,
  voice: VoiceName,
  isMultiSpeaker: boolean,
  onDone: () => void,
  onError: (err: string) => void,
  settings: SpeechSettings = DEFAULT_SPEECH_SETTINGS
) {
  if (!window.speechSynthesis) {
    onError('Speech Synthesis not supported');
    return;
  }

  // If paused, resume instead
  if (isPaused && currentUtterance) {
    window.speechSynthesis.resume();
    isPaused = false;
    return;
  }

  // Fresh start
  window.speechSynthesis.cancel();
  isPaused = false;
  currentSettings = settings;

  if (!isMultiSpeaker) {
    const utterance = new SpeechSynthesisUtterance(text);
    const preference = VOICE_PREFERENCES[voice];
    const bestVoice = findBestVoice(preference);
    if (bestVoice) utterance.voice = bestVoice;
    utterance.lang = 'en-US';
    utterance.rate = currentSettings.rate;
    utterance.pitch = currentSettings.pitch;

    utterance.onend = () => {
      currentUtterance = null;
      onDone();
    };
    utterance.onerror = (e) => {
      currentUtterance = null;
      if (e.error !== 'interrupted') {
        onError(`Speech error: ${e.error}`);
      }
    };

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  } else {
    const segments = segmentText(text);
    let index = 0;

    const speakNext = () => {
      if (index >= segments.length) {
        currentUtterance = null;
        onDone();
        return;
      }

      const seg = segments[index];
      const utterance = new SpeechSynthesisUtterance(seg.text);

      if (seg.speaker === 'Narrator') {
        const preference = VOICE_PREFERENCES[voice];
        const bestVoice = findBestVoice(preference);
        if (bestVoice) utterance.voice = bestVoice;
      } else {
        const voices = getVoices();
        const availableVoices = voices.filter(v => v.lang.startsWith('en'));
        const charHash = seg.speaker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const charVoice = availableVoices[charHash % Math.max(availableVoices.length, 1)];
        if (charVoice) utterance.voice = charVoice;
        utterance.pitch = (1.1 + (charHash % 3) * 0.15) * currentSettings.pitch;
      }

      utterance.lang = 'en-US';
      utterance.rate = currentSettings.rate;

      utterance.onend = () => {
        index++;
        speakNext();
      };
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted') {
          console.warn('Speech segment error:', e.error);
        }
        index++;
        speakNext();
      };

      currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  }
}

export function pauseSpeech(): void {
  if (window.speechSynthesis && currentUtterance && !isPaused) {
    window.speechSynthesis.pause();
    isPaused = true;
  }
}

export function resumeSpeech(): void {
  if (window.speechSynthesis && isPaused) {
    window.speechSynthesis.resume();
    isPaused = false;
  }
}

export function isSpeechPaused(): boolean {
  return isPaused;
}

export function updateSpeechSettings(settings: SpeechSettings): void {
  currentSettings = settings;
}

// Stub for image generation (removed - no API key)
export async function generateSceneImage(_text: string): Promise<string> {
  throw new Error('Image generation requires an API key. This is a standalone version.');
}

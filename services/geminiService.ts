import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceName, AVAILABLE_VOICES } from "../types";
import { audioCache } from "../utils/cache";

// --- Helpers for Audio Processing ---

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function concatAudioBuffers(buffers: Uint8Array[]): Uint8Array {
  const silenceLen = 7200; 
  const silence = new Uint8Array(silenceLen); 

  const processedBuffers = buffers.map(b => {
    if (b.length % 2 !== 0) {
        const padded = new Uint8Array(b.length + 1);
        padded.set(b);
        return padded;
    }
    return b;
  });

  const totalLen = processedBuffers.reduce((acc, b, i) => acc + b.length + (i < processedBuffers.length - 1 ? silenceLen : 0), 0);
  const result = new Uint8Array(totalLen);
  
  let offset = 0;
  processedBuffers.forEach((b, i) => {
    result.set(b, offset);
    offset += b.length;
    if (i < processedBuffers.length - 1) {
      result.set(silence, offset);
      offset += silenceLen;
    }
  });
  
  return result;
}

// --- Request Queue for Rate Limiting ---

class RequestQueue {
  private queue: Array<{task: () => Promise<void>, reject: (reason?: any) => void}> = [];
  private isProcessing = false;
  private delayMs = 600;

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
        reject
      });
      this.process();
    });
  }

  // New: Allows clearing pending requests when user jumps to a new location
  // This saves quota by not generating audio for skipped sections.
  clear() {
    this.queue.forEach(item => item.reject(new Error("Request cancelled by user navigation")));
    this.queue = [];
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
          await item.task();
          // Wait before processing next item
          await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }

    this.isProcessing = false;
  }
}

// Global queue instance
const apiQueue = new RequestQueue();

export function cancelGenerations() {
    apiQueue.clear();
}

// --- Retry Logic ---

async function withRetry<T>(operation: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err.message?.includes('429') || err.status === 429 || err.message?.toLowerCase().includes('quota');
      const isServerOverload = err.status === 503;
      
      if (err.message?.includes('limit: 0')) {
          throw new Error("Daily API Quota Exceeded. Please check your Google Cloud billing or try again tomorrow.");
      }

      if ((isRateLimit || isServerOverload) && i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i) + (Math.random() * 500);
        console.warn(`API Rate limit hit. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      if (!isRateLimit && !isServerOverload) throw err;
    }
  }
  throw lastError;
}

// --- Voice Assignment Logic ---

function getVoiceForSpeaker(speakerName: string, narratorVoiceName: VoiceName): VoiceName {
  const name = speakerName.trim().toLowerCase();
  if (name === 'narrator') return narratorVoiceName;

  const available = AVAILABLE_VOICES.filter(v => v.name !== narratorVoiceName);
  if (available.length === 0) return narratorVoiceName;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const index = Math.abs(hash) % available.length;
  return available[index].name;
}

// --- API Interactions ---

export async function generateSceneImage(text: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
  const prompt = `Create a cinematic, high-quality digital illustration depicting this scene. Style: Atmospheric, detailed. Scene description: ${text.slice(0, 500)}`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: { parts: [{ text: prompt }] },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data found in response");
  });
}

async function analyzeTextForSegments(text: string): Promise<Array<{speaker: string, text: string}>> {
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
  
  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        speaker: { type: Type.STRING, description: "Name of the speaker (e.g., 'Narrator', 'John', 'Mary')" },
        text: { type: Type.STRING, description: "The text spoken by this speaker" }
      },
      required: ["speaker", "text"]
    }
  };

  // Note: We use the queue for analysis too, as it consumes quota
  return apiQueue.add(() => withRetry(async () => {
    // We switched to 'gemini-1.5-flash' (Standard Flash).
    // It is smarter than Lite (better detection) but cheaper/faster than Pro.
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `You are a professional script editor. 
      Analyze the text and split it into dialogue segments for an audio drama.
      
      Instructions:
      1. Identify the 'Narrator' and distinct characters.
      2. 'Narrator' handles all descriptions, internal thoughts, and speech tags (e.g., "he said").
      3. Characters only handle their actual spoken words (usually inside quotes).
      4. Merge consecutive segments from the same speaker into one block.
      5. Preserve the text EXACTLY as written.
      
      Input Text:
      "${text.slice(0, 4500)}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      }
    });

    try {
      const rawJSON = response.text || "[]";
      const parsed = JSON.parse(rawJSON);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      // Fallback if array is empty
      return [{ speaker: "Narrator", text: text }]; 
    } catch (e) {
      console.error("Failed to parse segmentation JSON", e);
      return [{ speaker: "Narrator", text: text }]; 
    }
  }));
}

async function generateSingleSpeakerAudio(text: string, voice: VoiceName): Promise<Uint8Array> {
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
  
  return apiQueue.add(() => withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) throw new Error("Empty audio response");
    
    return decodeBase64(base64);
  }));
}

// --- Main Export ---

export async function generateSpeech(
  text: string, 
  voice: VoiceName, 
  isMultiSpeaker: boolean = false
): Promise<string> {
  if (!import.meta.env.VITE_GEMINI_API_KEY) throw new Error("API Key is missing.");

  // 1. Check Cache (Persistent IndexedDB)
  const cacheKey = audioCache.generateKey(text, voice, isMultiSpeaker ? 'multi' : 'single');
  const cachedBase64 = await audioCache.get(cacheKey);
  if (cachedBase64) {
      console.log("Audio served from cache (0 API calls)");
      return cachedBase64;
  }

  let resultBase64 = "";

  if (!isMultiSpeaker) {
    const audioBytes = await generateSingleSpeakerAudio(text, voice);
    resultBase64 = encodeBase64(audioBytes);
  } else {
    try {
      const segments = await analyzeTextForSegments(text);
      const audioBuffers: Uint8Array[] = [];
      
      for (const seg of segments) {
          const assignedVoice = getVoiceForSpeaker(seg.speaker, voice);
          const audio = await generateSingleSpeakerAudio(seg.text, assignedVoice);
          audioBuffers.push(audio);
      }

      const mergedAudio = concatAudioBuffers(audioBuffers);
      resultBase64 = encodeBase64(mergedAudio);

    } catch (error) {
      console.error("Multi-speaker generation failed, falling back to single speaker:", error);
      const audioBytes = await generateSingleSpeakerAudio(text, voice);
      resultBase64 = encodeBase64(audioBytes);
    }
  }

  // 3. Save to Cache
  if (resultBase64) {
      await audioCache.set(cacheKey, resultBase64);
  }

  return resultBase64;
}
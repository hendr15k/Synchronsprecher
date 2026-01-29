import React, { useState, useRef, useEffect } from 'react';
import { VoiceName, AudioState } from './types';
import { decodeBase64, decodeAudioData } from './utils/audioUtils';
import { generateSpeech, generateSceneImage, cancelGenerations } from './services/geminiService';
import { parseFile } from './utils/fileParsers';
import { chunkText } from './utils/textProcessors';
import { VoiceSelector } from './components/VoiceSelector';
import { PlayerBar } from './components/PlayerBar';

// Reduced from 2 to 1 to prevent hitting API Rate Limits on free tiers
const PRELOAD_WINDOW = 1;

const App: React.FC = () => {
  // --- Text & UI State ---
  const [text, setText] = useState<string>(
    "Welcome to the ElevenReader Clone. Paste long text or upload an ePub/PDF to see the 'Stage Reading' in action. Once you start, tap any paragraph to jump there, or click 'Visualize' to see the scene."
  );
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Kore);
  const [useMultiSpeaker, setUseMultiSpeaker] = useState<boolean>(false);
  const [isReaderMode, setIsReaderMode] = useState<boolean>(false);
  
  // --- Reading Session State ---
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Text Chunks
  const [textChunks, setTextChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  
  // Audio Cache: Maps chunk index -> Promise<AudioBuffer>
  const audioCacheRef = useRef<Map<number, Promise<AudioBuffer>>>(new Map());

  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    isLoading: false,
    error: null,
    buffer: null,
  });

  // --- Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0); // For progress bar visualization only
  const progressFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChunkRef = useRef<HTMLDivElement | null>(null);

  // --- Cleanup ---
  useEffect(() => {
    return () => stopPlaybackFull();
  }, []);

  // Scroll to active chunk
  useEffect(() => {
    if (isReaderMode && activeChunkRef.current) {
        activeChunkRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentChunkIndex, isReaderMode]);

  // --- Audio Context Management ---
  const getAudioContext = async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }
    
    // Always ensure running
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const stopPlaybackFull = () => {
    // 1. Cancel any pending API calls to save quota
    cancelGenerations();

    // 2. Stop Audio
    if (sourceNodeRef.current) {
      try { 
        sourceNodeRef.current.stop(); 
        sourceNodeRef.current.disconnect(); 
        sourceNodeRef.current.onended = null; // Prevent callback
      } catch {}
      sourceNodeRef.current = null;
    }
    if (progressFrameRef.current) cancelAnimationFrame(progressFrameRef.current);
    
    // 3. Clear In-Memory Promises (but kept in IndexedDB)
    audioCacheRef.current.clear();
    
    setAudioState(prev => ({ 
      ...prev, 
      isPlaying: false, 
      currentTime: 0, 
      duration: 0 
    }));
  };

  // --- Fetching Logic ---

  const fetchAudioForChunk = (index: number, chunkText: string): Promise<AudioBuffer> => {
    if (audioCacheRef.current.has(index)) {
      return audioCacheRef.current.get(index)!;
    }

    const promise = (async () => {
        const ctx = await getAudioContext();
        // Generate (will check IndexedDB cache internally first)
        const base64 = await generateSpeech(chunkText, selectedVoice, useMultiSpeaker);
        const bytes = decodeBase64(base64);
        return await decodeAudioData(bytes, ctx);
    })();

    promise.catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('cancelled')) {
             console.log(`Fetch cancelled for chunk ${index}`);
        } else {
             console.error(`Failed to fetch chunk ${index}`, err);
        }
        // Do NOT delete from cache immediately. Let the UI handle the error when it attempts to play.
    });

    audioCacheRef.current.set(index, promise);
    return promise;
  };

  const ensurePreload = (currentIndex: number, allChunks: string[]) => {
    for (let i = 1; i <= PRELOAD_WINDOW; i++) {
        const nextIndex = currentIndex + i;
        if (nextIndex < allChunks.length) {
            fetchAudioForChunk(nextIndex, allChunks[nextIndex]);
        }
    }
  };

  // --- Playback Logic ---

  const playChunk = async (index: number, allChunks: string[], startOffset: number = 0) => {
    if (index >= allChunks.length) {
        setAudioState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
        return;
    }

    try {
        const ctx = await getAudioContext();
        
        // 1. Set Loading State
        setCurrentChunkIndex(index);
        setAudioState(prev => ({ ...prev, isLoading: true, error: null }));

        // 2. Fetch or Get Buffer
        const buffer = await fetchAudioForChunk(index, allChunks[index]);

        // 3. Stop Previous Source
        if (sourceNodeRef.current) {
             try { 
                 sourceNodeRef.current.onended = null; // Important: detach old handler
                 sourceNodeRef.current.stop(); 
                 sourceNodeRef.current.disconnect(); 
             } catch {}
        }

        // 4. Create & Config Source
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNodeRef.current!);
        
        // 5. Setup "Next Chunk" Handler (The most robust way to sequence)
        source.onended = () => {
             // Only proceed if we are still playing this specific source node
             // (prevents triggers from manually stopped nodes)
             if (audioState.isPlaying) {
                 playChunk(index + 1, allChunks);
             }
        };

        // 6. Start Playback
        const safeOffset = Math.min(startOffset, buffer.duration);
        source.start(0, safeOffset);
        sourceNodeRef.current = source;
        
        // 7. Update UI State
        startTimeRef.current = ctx.currentTime - safeOffset;
        setAudioState({
            isPlaying: true,
            currentTime: safeOffset,
            duration: buffer.duration,
            isLoading: false,
            error: null,
            buffer: buffer
        });

        // 8. Start Visual Progress Loop
        startVisualTimer(buffer.duration);

        // 9. Background Preload
        ensurePreload(index, allChunks);

        // 10. Clean old cache to save RAM
        if (index > 2) audioCacheRef.current.delete(index - 3);

    } catch (err: unknown) {
        // Enhance error message for end users
        let msg = err instanceof Error ? err.message : "Unknown error";
        
        // Handle specific 429 messages
        if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
            msg = "API Daily Limit Reached. Please check your Google Cloud quota.";
        } else if (msg.includes('cancelled')) {
             return; // Ignore cancelled requests
        } else if (msg.includes('fetch')) {
             msg = "Connection error. Please check your internet.";
        }

        setAudioState(prev => ({ 
            ...prev, 
            isLoading: false, 
            isPlaying: false,
            error: msg 
        }));
    }
  };

  // Only updates the visual progress bar, does NOT control logic
  const startVisualTimer = (duration: number) => {
    if (progressFrameRef.current) cancelAnimationFrame(progressFrameRef.current);
    
    const loop = () => {
      if (!audioContextRef.current) return;
      const now = audioContextRef.current.currentTime;
      const elapsed = now - startTimeRef.current;

      if (elapsed < duration) {
        setAudioState(prev => ({ ...prev, currentTime: elapsed }));
        progressFrameRef.current = requestAnimationFrame(loop);
      } else {
        setAudioState(prev => ({ ...prev, currentTime: duration }));
      }
    };
    progressFrameRef.current = requestAnimationFrame(loop);
  };

  // --- Interaction Handlers ---

  const startReading = async () => {
      if (!text.trim()) return;

      stopPlaybackFull();
      audioCacheRef.current.clear();
      setIsReaderMode(true);
      setGeneratedImageUrl(null);

      const chunks = chunkText(text, 1500); // Updated default to match new optimization
      setTextChunks(chunks);
      setCurrentChunkIndex(0);

      // Force context unlock on click
      await getAudioContext();

      playChunk(0, chunks);
  };

  const jumpToChunk = async (index: number) => {
      // Clear pending generations to save quota!
      cancelGenerations();
      
      // Clear the in-memory cache to prevent memory leaks from previous distant chunks
      // We rely on IndexedDB for persistence; RAM should be freed.
      audioCacheRef.current.clear();

      // Don't stopFull() here, just switch. 
      // playChunk will handle stopping the previous node.
      if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
      playChunk(index, textChunks);
  };

  const togglePlayPause = async () => {
      const ctx = await getAudioContext();
      
      if (audioState.isPlaying) {
          ctx.suspend();
          setAudioState(prev => ({ ...prev, isPlaying: false }));
      } else {
          ctx.resume();
          setAudioState(prev => ({ ...prev, isPlaying: true }));
      }
  };

  const handleSeek = (percentage: number) => {
    if (!audioState.buffer) return;
    const newTime = percentage * audioState.buffer.duration;
    playChunk(currentChunkIndex, textChunks, newTime);
  };

  const handleGenerateImage = async () => {
      if (!textChunks[currentChunkIndex]) return;
      setIsGeneratingImage(true);
      try {
          const imgUrl = await generateSceneImage(textChunks[currentChunkIndex]);
          setGeneratedImageUrl(imgUrl);
      } catch (e: unknown) {
          console.error(e);
          setAudioState(prev => ({ ...prev, error: "Image generation failed." }));
      } finally {
          setIsGeneratingImage(false);
      }
  };

  const processFile = async (file: File) => {
    setIsProcessingFile(true);
    setAudioState(prev => ({ ...prev, error: null }));
    try {
      const extractedText = await parseFile(file);
      setText(extractedText);
      setIsReaderMode(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAudioState(prev => ({ ...prev, error: `Import failed: ${msg}` }));
    } finally {
      setIsProcessingFile(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-950 text-stone-200">
      <input type="file" ref={fileInputRef} onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
        e.target.value = '';
      }} accept=".pdf,.epub,.txt,.md" className="hidden" />

      <header className="flex-shrink-0 h-16 border-b border-stone-800 flex items-center px-6 justify-between bg-stone-950 z-20">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-lg">11</div>
          <h1 className="text-lg font-bold text-white">ElevenReader <span className="text-stone-500 font-normal">Clone</span></h1>
        </div>
        <div className="flex items-center gap-2">
            {isReaderMode && (
                <button 
                  onClick={() => setIsReaderMode(false)}
                  className="text-xs font-mono text-stone-500 hover:text-stone-300 transition-colors uppercase"
                >
                    Edit Text
                </button>
            )}
            <div className="text-xs font-mono text-stone-600 border border-stone-800 rounded px-2 py-1 uppercase tracking-tighter">
                Interactive
            </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-stone-800 bg-stone-925 overflow-y-auto hidden md:flex flex-col p-6 gap-8 shrink-0">
           {/* Image Display */}
           {generatedImageUrl && (
               <div className="animate-in fade-in slide-in-from-left-4">
                    <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Scene Visual</h2>
                    <div className="rounded-lg overflow-hidden border border-stone-700 shadow-xl bg-black aspect-square relative group">
                        <img src={generatedImageUrl} alt="Scene" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <span className="text-xs text-white/80">Gemini 2.5 Flash Image</span>
                        </div>
                    </div>
               </div>
           )}

           <div>
              <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-4">Library</h2>
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessingFile}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-stone-900 border border-stone-800 hover:bg-stone-800 transition-all group"
              >
                 <div className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
                    <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                 </div>
                 <div className="text-left">
                     <div className="text-sm font-medium text-stone-200">Import Book</div>
                     <div className="text-xs text-stone-500">PDF, ePub, TXT</div>
                 </div>
              </button>
           </div>

           <div>
              <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider">Voices</h2>
                  <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-500 font-bold uppercase">Auto-Cast</span>
                      <button 
                        onClick={() => setUseMultiSpeaker(!useMultiSpeaker)}
                        className={`w-8 h-4 rounded-full transition-colors relative ${useMultiSpeaker ? 'bg-indigo-500' : 'bg-stone-800'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${useMultiSpeaker ? 'left-4.5' : 'left-0.5'}`} />
                      </button>
                  </div>
              </div>
              
              <VoiceSelector 
                label="Narrator"
                selectedVoice={selectedVoice} 
                onSelectVoice={setSelectedVoice} 
                disabled={audioState.isLoading || isProcessingFile || audioState.isPlaying} 
              />

              {useMultiSpeaker && (
                  <div className="mt-4 p-3 bg-stone-900 border border-stone-800 rounded-lg animate-in fade-in slide-in-from-top-2 border-l-4 border-l-indigo-500">
                     <p className="text-[11px] text-stone-500 leading-relaxed italic">
                        Characters detected automatically. Narrator uses the selected voice.
                     </p>
                  </div>
              )}
           </div>
        </aside>

        {/* Main Content */}
        <main 
            className="flex-1 flex flex-col relative min-w-0 bg-stone-950"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => { 
                e.preventDefault(); setIsDragging(false); 
                const file = e.dataTransfer.files?.[0];
                if (file) await processFile(file);
            }}
        >
          {isDragging && (
             <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm border-2 border-dashed border-indigo-500 flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-indigo-200 animate-bounce">Drop file</div>
             </div>
          )}

          {/* Mobile Upload */}
          <div className="md:hidden p-4 border-b border-stone-800 bg-stone-900/30 flex gap-2">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-2 bg-stone-800 rounded text-xs font-medium border border-stone-700 text-stone-300"
              >
                 Upload
              </button>
              <button
                 onClick={() => setUseMultiSpeaker(!useMultiSpeaker)}
                 className={`px-3 py-2 rounded text-xs font-medium border ${useMultiSpeaker ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-stone-800 border-stone-700 text-stone-400'}`}
              >
                 Auto-Cast: {useMultiSpeaker ? "ON" : "OFF"}
              </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-12 lg:px-24">
             {/* Mobile Image Display (Only visible on mobile if image exists) */}
             {generatedImageUrl && (
                 <div className="md:hidden mb-6 animate-in fade-in slide-in-from-top-4">
                    <div className="rounded-lg overflow-hidden border border-stone-700 shadow-xl bg-black aspect-square relative">
                        <img src={generatedImageUrl} alt="Scene" className="w-full h-full object-cover" />
                        <button 
                           onClick={() => setGeneratedImageUrl(null)}
                           className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full backdrop-blur-md"
                        >
                           <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                            <span className="text-xs text-white/80">Gemini 2.5 Flash Image</span>
                        </div>
                    </div>
                 </div>
             )}

             {!isReaderMode ? (
                 <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste text or upload a book..."
                    className="w-full h-full bg-transparent border-none resize-none focus:ring-0 text-lg md:text-xl lg:text-2xl font-serif leading-relaxed text-stone-300 placeholder-stone-700 outline-none"
                    spellCheck={false}
                 />
             ) : (
                 <div className="space-y-6 pb-24">
                    {textChunks.map((chunk, idx) => (
                        <div 
                            key={idx}
                            ref={idx === currentChunkIndex ? activeChunkRef : null}
                            onClick={() => jumpToChunk(idx)}
                            className={`
                                font-serif text-lg md:text-xl lg:text-2xl leading-relaxed transition-all duration-300 cursor-pointer p-4 rounded-xl border
                                ${idx === currentChunkIndex 
                                    ? 'bg-stone-900/80 text-white border-stone-800 shadow-2xl scale-[1.02] ring-1 ring-indigo-500/30' 
                                    : 'text-stone-500 hover:text-stone-300 hover:bg-stone-900/30 border-transparent'
                                }
                            `}
                        >
                            {chunk}
                        </div>
                    ))}
                 </div>
             )}
          </div>
          
          <div className="absolute bottom-6 right-6 md:bottom-12 md:right-12 z-10 flex flex-col items-end gap-3 pointer-events-none">
             {/* Main Action Button (Only visible if not reading, or processing) */}
             <div className="pointer-events-auto">
                {isProcessingFile && (
                    <div className="mb-2 px-4 py-2 bg-stone-900 border border-stone-800 rounded-full text-xs text-stone-400 animate-pulse">
                    Extracting Text...
                    </div>
                )}
                
                {!isReaderMode && !audioState.isLoading && (
                <button
                    onClick={startReading}
                    disabled={isProcessingFile || !text.trim()}
                    className="flex items-center gap-2 px-8 py-4 rounded-full font-bold shadow-2xl bg-white text-black hover:bg-stone-200 transition-all transform hover:scale-105"
                >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <span>Start Reading</span>
                </button>
                )}

                {audioState.isLoading && (
                    <div className="px-6 py-3 rounded-full bg-stone-800 text-stone-400 flex items-center gap-3 border border-stone-700 shadow-xl">
                        <svg className="animate-spin h-5 w-5 text-indigo-500" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span>{useMultiSpeaker ? "Casting..." : "Loading..."}</span>
                    </div>
                )}
             </div>
          </div>
          
          {audioState.error && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-red-500/10 border border-red-500/50 text-red-200 px-6 py-3 rounded-xl backdrop-blur-md text-sm z-50 animate-in fade-in slide-in-from-top-4 shadow-2xl">
                {audioState.error}
            </div>
          )}
        </main>
      </div>

      <PlayerBar 
        isPlaying={audioState.isPlaying} 
        onPlayPause={togglePlayPause} 
        onSeek={handleSeek}
        onGenerateImage={handleGenerateImage}
        isGeneratingImage={isGeneratingImage}
        currentTime={audioState.currentTime} 
        duration={audioState.duration} 
        disabled={!audioState.buffer} 
        title={audioState.buffer ? (useMultiSpeaker ? "Multi-Cast Audio" : "Narrated Audio") : "ElevenReader"} 
      />
    </div>
  );
};

export default App;
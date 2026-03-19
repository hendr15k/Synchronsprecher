import React, { useState, useRef, useEffect } from 'react';
import { VoiceName, VoiceConfig, AVAILABLE_VOICES, loadSystemVoices } from './types';
import { speakWithWebSpeech, cancelGenerations } from './services/geminiService';
import { parseFile } from './utils/fileParsers';
import { chunkText } from './utils/textProcessors';
import { VoiceSelector } from './components/VoiceSelector';
import { PlayerBar } from './components/PlayerBar';

const App: React.FC = () => {
  const [text, setText] = useState<string>(
    "Welcome to Synchronsprecher! Paste text or upload a document to hear it read aloud using your browser's built-in speech engine. No API key needed — works completely offline!\n\n\"This is a dialogue line,\" said the Narrator. \"Click Start Reading to begin.\"\n\nYou can upload PDF, ePub, or TXT files, or just paste any text. The app will automatically detect different speakers and use different voices for characters."
  );
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Kore);
  const [useMultiSpeaker, setUseMultiSpeaker] = useState<boolean>(false);
  const [isReaderMode, setIsReaderMode] = useState<boolean>(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [systemVoicesLoaded, setSystemVoicesLoaded] = useState(false);
  
  // Text Chunks
  const [textChunks, setTextChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimatedProgress, setEstimatedProgress] = useState(0);

  const activeChunkRef = useRef<HTMLDivElement | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  // Load system voices on mount
  useEffect(() => {
    loadSystemVoices().then(() => setSystemVoicesLoaded(true));
  }, []);

  // Scroll to active chunk
  useEffect(() => {
    if (isReaderMode && activeChunkRef.current) {
      activeChunkRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentChunkIndex, isReaderMode]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelGenerations();
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  const stopSpeaking = () => {
    cancelGenerations();
    setIsSpeaking(false);
    setCurrentChunkIndex(0);
    setEstimatedProgress(0);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const speakChunk = (index: number, allChunks: string[]) => {
    if (index >= allChunks.length) {
      setIsSpeaking(false);
      setEstimatedProgress(100);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      return;
    }

    setCurrentChunkIndex(index);
    setIsSpeaking(true);
    setError(null);

    // Estimate duration: ~150 words per minute
    const wordCount = allChunks[index].split(/\s+/).length;
    const estimatedSeconds = (wordCount / 150) * 60;
    
    // Start progress simulation
    let elapsed = 0;
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      elapsed += 0.5;
      const chunkProgress = Math.min((elapsed / estimatedSeconds) * 100, 100);
      const totalProgress = ((index + chunkProgress / 100) / allChunks.length) * 100;
      setEstimatedProgress(totalProgress);
    }, 500);

    speakWithWebSpeech(
      allChunks[index],
      selectedVoice,
      useMultiSpeaker,
      () => {
        // Done speaking this chunk
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        speakChunk(index + 1, allChunks);
      },
      (err) => {
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        if (!err.includes('cancelled')) {
          setError(err);
        }
        setIsSpeaking(false);
      }
    );
  };

  const startReading = async () => {
    if (!text.trim()) return;
    
    stopSpeaking();
    setIsReaderMode(true);
    setError(null);

    const chunks = chunkText(text, 1500);
    setTextChunks(chunks);
    setCurrentChunkIndex(0);

    speakChunk(0, chunks);
  };

  const jumpToChunk = (index: number) => {
    cancelGenerations();
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    speakChunk(index, textChunks);
  };

  const togglePlayPause = () => {
    if (isSpeaking) {
      window.speechSynthesis?.pause();
      setIsSpeaking(false);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    } else {
      window.speechSynthesis?.resume();
      setIsSpeaking(true);
    }
  };

  const processFile = async (file: File) => {
    setIsProcessingFile(true);
    setError(null);
    try {
      const extractedText = await parseFile(file);
      setText(extractedText);
      setIsReaderMode(false);
    } catch (err: any) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-950 text-stone-200">
      <input type="file" id="fileInput" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
        e.target.value = '';
      }} accept=".pdf,.epub,.txt,.md" className="hidden" />

      <header className="flex-shrink-0 h-16 border-b border-stone-800 flex items-center px-6 justify-between bg-stone-950 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-lg">SS</div>
          <h1 className="text-lg font-bold text-white">Synchronsprecher</h1>
          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-medium">Offline</span>
        </div>
        <div className="flex items-center gap-2">
          {isReaderMode && (
            <button onClick={() => { stopSpeaking(); setIsReaderMode(false); }}
              className="text-xs font-mono text-stone-500 hover:text-stone-300 transition-colors uppercase">
              Edit Text
            </button>
          )}
          <div className="text-xs font-mono text-stone-600 border border-stone-800 rounded px-2 py-1 uppercase tracking-tighter">
            Web Speech API
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-stone-800 bg-stone-925 overflow-y-auto hidden md:flex flex-col p-6 gap-8 shrink-0">
          <div>
            <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-4">Library</h2>
            <button onClick={() => document.getElementById('fileInput')?.click()}
              disabled={isProcessingFile}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-stone-900 border border-stone-800 hover:bg-stone-800 transition-all group">
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
                <button onClick={() => setUseMultiSpeaker(!useMultiSpeaker)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${useMultiSpeaker ? 'bg-indigo-500' : 'bg-stone-800'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${useMultiSpeaker ? 'left-4.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
            
            <VoiceSelector label="Narrator" selectedVoice={selectedVoice} onSelectVoice={setSelectedVoice}
              disabled={isProcessingFile || isSpeaking} />

            {useMultiSpeaker && (
              <div className="mt-4 p-3 bg-stone-900 border border-stone-800 rounded-lg animate-in fade-in slide-in-from-top-2 border-l-4 border-l-indigo-500">
                <p className="text-[11px] text-stone-500 leading-relaxed italic">
                  Characters detected automatically. Narrator uses the selected voice.
                </p>
              </div>
            )}
          </div>

          {systemVoicesLoaded && (
            <div className="mt-auto">
              <p className="text-[10px] text-stone-600">
                {window.speechSynthesis?.getVoices().length || 0} system voices available
              </p>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative min-w-0 bg-stone-950"
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={async (e) => {
            e.preventDefault(); setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await processFile(file);
          }}>
          
          {isDragging && (
            <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm border-2 border-dashed border-indigo-500 flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-indigo-200 animate-bounce">Drop file</div>
            </div>
          )}

          {/* Mobile Upload */}
          <div className="md:hidden p-4 border-b border-stone-800 bg-stone-900/30 flex gap-2">
            <button onClick={() => document.getElementById('fileInput')?.click()}
              className="flex-1 py-2 bg-stone-800 rounded text-xs font-medium border border-stone-700 text-stone-300">
              Upload
            </button>
            <button onClick={() => setUseMultiSpeaker(!useMultiSpeaker)}
              className={`px-3 py-2 rounded text-xs font-medium border ${useMultiSpeaker ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-stone-800 border-stone-700 text-stone-400'}`}>
              Auto-Cast: {useMultiSpeaker ? "ON" : "OFF"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-12 lg:px-24">
            {!isReaderMode ? (
              <textarea value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Paste text or upload a book..."
                className="w-full h-full bg-transparent border-none resize-none focus:ring-0 text-lg md:text-xl lg:text-2xl font-serif leading-relaxed text-stone-300 placeholder-stone-700 outline-none"
                spellCheck={false} />
            ) : (
              <div className="space-y-6 pb-24">
                {textChunks.map((chunk, idx) => (
                  <div key={idx} ref={idx === currentChunkIndex ? activeChunkRef : null}
                    onClick={() => jumpToChunk(idx)}
                    className={`font-serif text-lg md:text-xl lg:text-2xl leading-relaxed transition-all duration-300 cursor-pointer p-4 rounded-xl border
                      ${idx === currentChunkIndex
                        ? 'bg-stone-900/80 text-white border-stone-800 shadow-2xl scale-[1.02] ring-1 ring-indigo-500/30'
                        : idx < currentChunkIndex
                          ? 'text-stone-400 border-transparent'
                          : 'text-stone-500 hover:text-stone-300 hover:bg-stone-900/30 border-transparent'
                      }`}>
                    {chunk}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="absolute bottom-6 right-6 md:bottom-12 md:right-12 z-10 flex flex-col items-end gap-3 pointer-events-none">
            <div className="pointer-events-auto">
              {isProcessingFile && (
                <div className="mb-2 px-4 py-2 bg-stone-900 border border-stone-800 rounded-full text-xs text-stone-400 animate-pulse">
                  Extracting Text...
                </div>
              )}
              
              {!isReaderMode && !isSpeaking && (
                <button onClick={startReading} disabled={isProcessingFile || !text.trim()}
                  className="flex items-center gap-2 px-8 py-4 rounded-full font-bold shadow-2xl bg-white text-black hover:bg-stone-200 transition-all transform hover:scale-105">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  <span>Start Reading</span>
                </button>
              )}

              {isSpeaking && (
                <div className="px-6 py-3 rounded-full bg-stone-800 text-stone-400 flex items-center gap-3 border border-stone-700 shadow-xl">
                  <svg className="animate-spin h-5 w-5 text-indigo-500" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span>Reading {currentChunkIndex + 1}/{textChunks.length}...</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-red-500/10 border border-red-500/50 text-red-200 px-6 py-3 rounded-xl backdrop-blur-md text-sm z-50 animate-in fade-in slide-in-from-top-4 shadow-2xl">
              {error}
            </div>
          )}
        </main>
      </div>

      <PlayerBar
        isPlaying={isSpeaking}
        onPlayPause={togglePlayPause}
        onSeek={() => {}}
        onGenerateImage={() => setError('Image generation requires an API key')}
        isGeneratingImage={false}
        currentTime={estimatedProgress}
        duration={100}
        disabled={!isReaderMode}
        title={isSpeaking ? `Reading chunk ${currentChunkIndex + 1}/${textChunks.length}` : "Synchronsprecher"}
        isPercentage={true}
      />
    </div>
  );
};

export default App;

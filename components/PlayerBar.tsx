import React from 'react';

interface PlayerBarProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (percentage: number) => void;
  onGenerateImage: () => void;
  currentTime: number;
  duration: number;
  disabled?: boolean;
  title?: string;
  isGeneratingImage?: boolean;
  isPercentage?: boolean;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  isPlaying,
  onPlayPause,
  onSeek,
  onGenerateImage,
  currentTime,
  duration,
  disabled,
  title = "Ready to read",
  isGeneratingImage = false,
  isPercentage = false
}) => {
  const progress = isPercentage ? currentTime : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const displayProgress = Math.min(Math.max(progress, 0), 100);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    onSeek(percentage);
  };

  return (
    <div className="h-24 bg-stone-900 border-t border-stone-800 flex items-center px-4 md:px-12 gap-4 md:gap-6 relative z-50">
      {/* Play/Pause Button */}
      <button
        onClick={onPlayPause}
        disabled={disabled}
        className={`
          flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all
          ${disabled
            ? 'bg-stone-800 text-stone-600 cursor-not-allowed'
            : 'bg-indigo-500 text-white hover:bg-indigo-400 shadow-lg shadow-indigo-500/20'
          }
        `}
      >
        {isPlaying ? (
          <svg className="w-4 h-4 md:w-5 md:h-5 fill-current" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="w-4 h-4 md:w-5 md:h-5 fill-current ml-1" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Info & Progress */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
        <div className="flex justify-between items-end">
          <h3 className="text-sm font-medium text-stone-200 truncate pr-4">
             {title}
          </h3>
          <span className="text-xs font-mono text-stone-500">
            {Math.round(displayProgress)}%
          </span>
        </div>

        {/* Progress Bar */}
        <div 
          className={`w-full h-2 bg-stone-800 rounded-full overflow-hidden relative group ${!disabled && 'cursor-pointer'}`}
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-indigo-500 rounded-full relative transition-all duration-300"
            style={{ width: `${displayProgress}%` }}
          >
             <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-sm transition-opacity" />
          </div>
        </div>
      </div>

      {/* Stop Button */}
      <button
        onClick={() => onSeek(0)}
        disabled={disabled}
        className={`
          flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg border transition-all flex-shrink-0
          ${disabled 
             ? 'opacity-30 cursor-not-allowed border-stone-800'
             : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-red-400 hover:border-red-500/50 hover:bg-stone-800'
          }
        `}
        title="Stop and reset"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
        </svg>
        <span className="hidden md:inline text-[10px] uppercase font-bold tracking-wider">Stop</span>
      </button>
    </div>
  );
};

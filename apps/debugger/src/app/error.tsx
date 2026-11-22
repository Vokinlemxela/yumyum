'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ErrorBoundary] Caught application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface border border-border-elite rounded-lg p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-warning/10 border border-accent-warning/20 flex items-center justify-center">
          <span className="text-accent-warning text-lg">⚠</span>
        </div>
        
        <h2 className="text-primary text-lg font-bold font-mono mb-2 tracking-wide">
          SYSTEM ERROR
        </h2>
        
        <p className="text-text-secondary text-xs font-mono mb-6 leading-relaxed">
          {error.message || 'An unexpected error occurred in the application.'}
        </p>

        {error.digest && (
          <p className="text-text-secondary/50 text-[9px] font-mono mb-4">
            Error ID: {error.digest}
          </p>
        )}
        
        <button
          onClick={reset}
          className="bg-surface hover:bg-surface-hover border border-border-elite text-primary text-xs font-mono font-bold px-6 py-2.5 rounded transition-colors cursor-pointer"
        >
          RELOAD APPLICATION
        </button>
      </div>
    </div>
  );
}

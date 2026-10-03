import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { IconCheck, IconClose } from './icons';

export interface FocusSessionItem {
  id: string;
  title: string;
  type: 'task' | 'learning' | 'goal' | 'custom';
  durationMin: number; // default 25, 45, 60, 90
  goalTitle?: string;
  relatedEntityId?: string;
}

interface FocusModeProps {
  item: FocusSessionItem;
  onClose: () => void;
  onComplete?: () => void;
}

export function FocusModeModal({ item, onClose, onComplete }: FocusModeProps) {
  const { update } = useApp();
  const [secondsLeft, setSecondsLeft] = useState(item.durationMin * 60);
  const [isRunning, setIsRunning] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const totalSeconds = item.durationMin * 60;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRunning && secondsLeft > 0) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            setIsFinished(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, secondsLeft]);

  // Keyboard accessibility: Escape to exit, Space to toggle pause/play
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        setIsRunning((r) => !r);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const progressPct = totalSeconds > 0 ? Math.min(100, Math.round(((totalSeconds - secondsLeft) / totalSeconds) * 100)) : 100;

  const handleCompleteItem = () => {
    if (item.type === 'task' && item.relatedEntityId) {
      update((d) => {
        d.tasks = (d.tasks ?? []).map((t) =>
          t.id === item.relatedEntityId
            ? { ...t, done: true, doneAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            : t
        );
        return { ...d };
      });
    } else if (item.type === 'learning' && item.relatedEntityId) {
      update((d) => {
        d.learning = (d.learning ?? []).map((l) =>
          l.id === item.relatedEntityId
            ? { ...l, status: 'completed', progress: 100, completionDate: new Date().toISOString().slice(0, 10) }
            : l
        );
        return { ...d };
      });
    }
    if (onComplete) onComplete();
    onClose();
  };

  return (
    <div
      className="modal-backdrop focus-mode-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 17, 23, 0.95)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#f8fafc',
        padding: '24px',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '24px',
          right: '24px',
          background: 'rgba(255,255,255,0.1)',
          border: 'none',
          color: '#cbd5e1',
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
        aria-label="Close focus mode"
      >
        <IconClose size={20} />
      </button>

      <div style={{ textAlign: 'center', maxWidth: '520px', width: '100%' }}>
        {item.goalTitle && (
          <div
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--accent, #6366f1)',
              marginBottom: '8px',
            }}
          >
            Goal: {item.goalTitle}
          </div>
        )}

        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            marginBottom: '32px',
            lineHeight: 1.3,
            color: '#ffffff',
          }}
        >
          {item.title}
        </h1>

        {/* Circular / Large Timer Display */}
        <div
          style={{
            position: 'relative',
            width: '260px',
            height: '260px',
            margin: '0 auto 36px',
            borderRadius: '50%',
            background: `conic-gradient(var(--accent, #6366f1) ${progressPct}%, rgba(255,255,255,0.08) 0%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              width: '240px',
              height: '240px',
              borderRadius: '50%',
              backgroundColor: '#0f172a',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '56px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: '#f8fafc',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {timeFormatted}
            </div>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
              {isFinished ? 'Session completed!' : isRunning ? 'In Focus' : 'Paused'}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', alignItems: 'center' }}>
          {!isFinished ? (
            <button
              onClick={() => setIsRunning((r) => !r)}
              className="btn"
              style={{
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: 600,
                borderRadius: '30px',
                backgroundColor: isRunning ? 'rgba(255,255,255,0.15)' : 'var(--accent, #6366f1)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {isRunning ? 'Pause' : 'Resume'}
            </button>
          ) : null}

          <button
            onClick={handleCompleteItem}
            className="btn"
            style={{
              padding: '12px 28px',
              fontSize: '16px',
              fontWeight: 600,
              borderRadius: '30px',
              backgroundColor: isFinished ? 'var(--pos, #10b981)' : 'rgba(255,255,255,0.1)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <IconCheck size={18} />
            {isFinished ? 'Done · Mark Complete' : 'Complete Task'}
          </button>
        </div>

        <div style={{ marginTop: '32px', fontSize: '12px', color: '#64748b' }}>
          Press <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Space</kbd> to pause/resume, <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Esc</kbd> to exit
        </div>
      </div>
    </div>
  );
}

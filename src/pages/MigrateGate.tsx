import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

/**
 * Migration gate — shown after first sign-in when meaningful data exists in
 * the local `growth-os.v1` document and the cloud account is empty.
 *   * Recommended: "Migrate my existing data" (auto-backup → push → verify).
 *   * Secondary: "Start fresh" — requires typing the confirmation word;
 *     local data is NEVER deleted (it remains the rollback copy and can be
 *     migrated later from Settings → Data).
 */
export function MigrateGate() {
  const { migration } = useApp();
  const auth = useAuth();
  const [confirmWord, setConfirmWord] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    const outcome = await migration.run();
    if (outcome.status === 'error') setError(outcome.message);
  };

  const out = migration.outcome;
  const done = out && (out.status === 'success' || out.status === 'already-migrated' || out.status === 'no-data');

  return (
    <div className="auth-wrap">
      <div className="auth-card" role="main">
        <div className="auth-brand">
          <span className="auth-mark">🌱</span>
          <span>
            <span className="auth-brand-name">Growth OS</span>
            <span className="auth-brand-sub">welcome, {auth.user?.name || auth.user?.email}</span>
          </span>
        </div>

        {done && out ? (
          <>
            <h1 className="auth-title">{out.status === 'success' ? 'Your data is safe in the cloud' : out.status === 'already-migrated' ? 'Already migrated' : 'Set up your account'}</h1>
            <p className="auth-sub">{out.message}</p>
            <button className="btn btn-primary btn-lg auth-submit" onClick={() => migration.dismiss()}>
              Continue to Growth OS
            </button>
          </>
        ) : (
          <>
            <h1 className="auth-title">We found your existing Growth OS data</h1>
            <p className="auth-sub">
              Your existing data is stored on this device. We can securely move it to your account so it is available across devices —
              goals, money, habits, learning, career, journal and everything else.
            </p>

            <div className="panel" style={{ margin: '12px 0' }}>
              <p className="small muted" style={{ margin: 0 }}>
                Before migrating we create a backup file and a local snapshot. Nothing on this device is deleted, and if anything fails you
                can simply retry.
              </p>
            </div>

            {error && (
              <div role="alert" className="auth-notice error" aria-live="polite">
                {error}
              </div>
            )}

            <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={migration.running} onClick={() => void run()}>
                {migration.running ? 'Migrating…' : 'Migrate my existing data'}
              </button>
            </div>

            <div className="auth-alt" style={{ marginTop: 22 }}>
              <details className="start-fresh">
                <summary className="linklike" style={{ cursor: 'pointer' }}>
                  Start fresh instead (keeps this device's data untouched)
                </summary>
                <div className="panel" style={{ marginTop: 10 }}>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    Your local data stays on this device and is not deleted. To confirm you understand, type <b>fresh</b> below.
                  </p>
                  <input
                    aria-label="Type fresh to confirm starting without your existing data"
                    value={confirmWord}
                    onChange={(e) => setConfirmWord(e.target.value)}
                    placeholder="type: fresh"
                    style={{ marginBottom: 8 }}
                  />
                  <div>
                    <button className="btn btn-sm" disabled={confirmWord.trim().toLowerCase() !== 'fresh' || migration.running} onClick={() => migration.skip()}>
                      Start fresh
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

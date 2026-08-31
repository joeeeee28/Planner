import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { defaultCycleEnd, cycleNameFromStart, DEFAULT_CYCLE_START, EXAMPLE_HABITS } from '../lib/defaults';
import { todayStr } from '../lib/dates';
import { uid } from '../lib/uid';
import { ProgressBar } from '../components/ui';
import type { Habit, Goal } from '../lib/types';

const STEPS = ['Focus areas', 'First goals', 'Habits', 'Career focus', 'Savings goal', 'Start your cycle'];
const TOTAL_STEPS = STEPS.length;

export function Onboarding() {
  const { data, update } = useApp();
  const [step, setStep] = useState(0);
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(() => new Set(data.growthAreas.map((a) => a.id)));
  const [goal1, setGoal1] = useState('');
  const [goal2, setGoal2] = useState('');
  const [goal3, setGoal3] = useState('');
  const [chosenHabits, setChosenHabits] = useState<Set<string>>(new Set(EXAMPLE_HABITS.filter((h) => h.active).map((h) => h.name)));
  const [currentPosition, setCurrentPosition] = useState('');
  const [targetDirection, setTargetDirection] = useState('');
  const [cycleStart, setCycleStart] = useState(DEFAULT_CYCLE_START);
  const [savingsName, setSavingsName] = useState('');
  const [savingsTarget, setSavingsTarget] = useState('');
  const [name, setName] = useState('');
  const [showAll, setShowAll] = useState(false);

  const t = todayStr();

  const canNext = (() => {
    switch (step) {
      case 0: return selectedAreas.size > 0;
      case 1: return true; // goals optional
      case 2: return true;
      case 3: return true;
      case 4: return true; // savings goal optional
      default: return true;
    }
  })();

  const finish = () => {
    const cycleName = cycleNameFromStart(cycleStart);
    update((d) => {
      d.onboarded = true;
      if (name.trim()) d.settings.name = name.trim();
      d.growthAreas = d.growthAreas.filter((a) => selectedAreas.has(a.id));
      // add chosen habits
      for (const ex of EXAMPLE_HABITS) {
        if (chosenHabits.has(ex.name) && !d.habits.some((h) => h.name.toLowerCase() === ex.name.toLowerCase())) {
          d.habits.push({ ...ex, id: uid('habit'), createdAt: t } as Habit);
        }
      }
      // goals
      const goalTexts = [goal1, goal2, goal3].map((g) => g.trim()).filter(Boolean);
      for (const g of goalTexts) {
        d.goals.push({
          id: uid('goal'),
          level: 'long-term',
          title: g,
          description: '',
          categoryId: d.growthAreas[0]?.id ?? 'area-career',
          startDate: cycleStart,
          targetDate: undefined,
          status: 'in-progress',
          progress: 0,
          milestones: [],
          notes: '',
          relatedHabitIds: [],
          createdAt: t,
        } as Goal);
      }
      // savings goal (optional)
      const sName = savingsName.trim();
      const sTarget = Number(savingsTarget);
      if (sName && sTarget > 0) {
        d.savingsGoals.push({
          id: uid('sgoal'),
          name: sName,
          targetAmount: sTarget,
          currentAmount: 0,
          targetDate: cycleStart,
          monthlyContributionTarget: undefined,
          notes: 'First savings goal',
          createdAt: t,
        });
      }
      // career
      d.career.currentPosition = currentPosition.trim();
      d.career.targetDirection = targetDirection.trim();
      // cycle
      if (!d.cycles.length) {
        d.cycles.push({
          id: uid('cycle'),
          name: cycleName,
          startDate: cycleStart,
          endDate: defaultCycleEnd(cycleStart),
          createdAt: t,
        });
      }
      return { ...d };
    });
    // Take the user to Day 1 of their growth cycle.
    navigate(`today/${cycleStart}`);
  };

  const areas = data.growthAreas;
  const visibleHabits = showAll ? EXAMPLE_HABITS : EXAMPLE_HABITS.slice(0, 5);

  return (
    <div className="app-shell">
      <main className="main" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="flex mb-16" style={{ gap: 10, alignItems: 'center' }}>
          <span className="brand-mark">🌱</span>
          <div className="grow">
            <div className="bold" style={{ fontSize: 17 }}>
              Welcome to Growth OS
            </div>
            <div className="tiny muted">A personal + professional growth system for the long run.</div>
          </div>
          <span className="tiny muted">
            Step {step + 1}/{TOTAL_STEPS}
          </span>
        </div>

        <ProgressBar pct={((step + 1) / TOTAL_STEPS) * 100} color="teal" />

        <div className="card mt-16" style={{ minHeight: 380 }}>
          {step === 0 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>What do you want to improve?</h2>
              <p className="card-sub">Pick your growth areas — you can edit these anytime in Settings.</p>
              <div className="grid grid-2">
                {areas.map((a) => (
                  <button
                    key={a.id}
                    className={`btn ${selectedAreas.has(a.id) ? 'btn-primary' : ''}`}
                    style={{ justifyContent: 'flex-start', padding: '12px 14px', fontSize: 14 }}
                    onClick={() =>
                      setSelectedAreas((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      })
                    }
                  >
                    <span style={{ fontSize: 20 }}>{a.icon}</span>
                    <span>{a.name}</span>
                    {selectedAreas.has(a.id) && <span className="spacer" />}
                    {selectedAreas.has(a.id) && <span>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>Create your first goals</h2>
              <p className="card-sub">Long-term goals that shape your year — add more detail anytime in Goals.</p>
              {[goal1, goal2, goal3].map((g, i) => (
                <div className="form-row" key={i}>
                  <input
                    value={g}
                    onChange={(e) => {
                      if (i === 0) setGoal1(e.target.value);
                      if (i === 1) setGoal2(e.target.value);
                      if (i === 2) setGoal3(e.target.value);
                    }}
                    placeholder={
                      i === 0
                        ? 'e.g. Become a lead engineer at my company'
                        : i === 1
                          ? 'e.g. Run a half marathon'
                          : 'e.g. Read 24 books (optional)'
                    }
                  />
                </div>
              ))}
              <div className="form-hint">You can skip this and add goals later.</div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>Choose your habits</h2>
              <p className="card-sub">Examples — pick what fits, change or delete them later.</p>
              <div className="grid grid-2">
                {visibleHabits.map((h) => (
                  <button
                    key={h.name}
                    className={`btn ${chosenHabits.has(h.name) ? 'btn-primary' : ''}`}
                    style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                    onClick={() =>
                      setChosenHabits((prev) => {
                        const next = new Set(prev);
                        if (next.has(h.name)) next.delete(h.name);
                        else next.add(h.name);
                        return next;
                      })
                    }
                  >
                    <span style={{ fontSize: 18 }}>{h.icon}</span>
                    <span>{h.name}</span>
                    {chosenHabits.has(h.name) && <span className="spacer" />}
                    {chosenHabits.has(h.name) && <span>✓</span>}
                  </button>
                ))}
              </div>
              <button className="btn btn-sm btn-ghost mt-8" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${EXAMPLE_HABITS.length} examples`}
              </button>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>Define your professional focus</h2>
              <p className="card-sub">This seeds your career roadmap — refine it anytime in Career.</p>
              <div className="form-row">
                <label className="form-label">Current position</label>
                <input value={currentPosition} onChange={(e) => setCurrentPosition(e.target.value)} placeholder="e.g. Software engineer" />
              </div>
              <div className="form-row">
                <label className="form-label">Where do you want to go?</label>
                <textarea
                  rows={2}
                  value={targetDirection}
                  onChange={(e) => setTargetDirection(e.target.value)}
                  placeholder="e.g. Staff engineer or engineering manager in 3 years"
                />
              </div>
              <div className="form-row">
                <label className="form-label">What should we call you?</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>Set a savings goal</h2>
              <p className="card-sub">
                Optional — a first money target for your new year. You can add more anytime in Money → Savings goals.
              </p>
              <div className="form-row">
                <label className="form-label">Goal name</label>
                <input value={savingsName} onChange={(e) => setSavingsName(e.target.value)} placeholder="e.g. Emergency fund" />
              </div>
              <div className="form-row">
                <label className="form-label">Target amount (INR)</label>
                <input type="number" min="0" value={savingsTarget} onChange={(e) => setSavingsTarget(e.target.value)} placeholder="e.g. 100000" />
              </div>
              <div className="form-hint">You can skip this and add goals later.</div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="card-title" style={{ fontSize: 19 }}>Start your growth cycle</h2>
              <p className="card-sub">
                A cycle is your personal year — from this date, everything is tracked against it. When it ends, start another; all
                history stays.
              </p>
              <div className="form-row">
                <label className="form-label">Cycle start date</label>
                <input type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} />
                <div className="form-hint">
                  Your cycle: <b>{cycleNameFromStart(cycleStart)}</b> — {defaultCycleEnd(cycleStart)}
                </div>
              </div>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {['2026-09-01', `${t.slice(0, 4)}-01-01`].map((d) => (
                  <button key={d} className={`btn btn-sm ${cycleStart === d ? 'btn-primary' : ''}`} onClick={() => setCycleStart(d)}>
                    {d === '2026-09-01' ? 'Sep 1, 2026 (suggested)' : 'Jan 1, this year'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex mt-16" style={{ justifyContent: 'space-between' }}>
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Back
          </button>
          {step < TOTAL_STEPS - 1 ? (
            <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Continue →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Start — Day 1 of my growth cycle
            </button>
          )}
        </div>

        <p className="tiny muted mt-16" style={{ textAlign: 'center' }}>
          Everything is saved locally in your browser — no account needed, refresh-safe. You can export backups in Settings.
        </p>
      </main>
    </div>
  );
}

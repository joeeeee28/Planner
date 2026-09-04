import { useRoute, navigate } from '../lib/router';
import { HabitsTab } from './Habits';
import { LearningTab } from './Learning';
import { CareerTab } from './Career';
import { CyclesTab } from './Cycles';
import { CycleReviewPage } from './Reviews';

const TABS = [
  { id: 'habits', label: 'Habits' },
  { id: 'learning', label: 'Learning' },
  { id: 'career', label: 'Career' },
  { id: 'cycles', label: 'Cycles' },
];

export function GrowthPage() {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route[1])?.id ?? 'habits') as string;

  // legacy cycle review route: #/growth/cycles/review/{id}
  if (route[1] === 'cycles' && route[2] === 'review') {
    return <CycleReviewPage cycleId={route[3]} />;
  }

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16">
        <div>
          <h1 className="t-title">Growth</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Habits, learning, career and your growth cycles.
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => navigate(`growth/${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'habits' && <HabitsTab />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'career' && <CareerTab />}
      {tab === 'cycles' && <CyclesTab />}
    </div>
  );
}

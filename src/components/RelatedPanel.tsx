import { useApp } from '../context/AppContext';
import { navigate } from '../lib/router';
import { formatMoney } from '../lib/finance';

export interface RelatedPanelProps {
  entityType: 'goal' | 'project' | 'person' | 'source' | 'learning';
  entityId: string;
}

export function RelatedPanel({ entityType, entityId }: RelatedPanelProps) {
  const { data } = useApp();
  const currency = data.settings.finance.currency;

  if (entityType === 'goal') {
    const goal = data.goals.find((g) => g.id === entityId);
    if (!goal) return null;

    const linkedTasks = (data.tasks ?? []).filter((t) => t.goalId === entityId);
    const openTasks = linkedTasks.filter((t) => !t.done);
    const doneTasks = linkedTasks.filter((t) => t.done);
    const habits = data.habits.filter((h) => (goal.relatedHabitIds ?? []).includes(h.id));
    const learning = data.learning.filter((l) => l.goalId === entityId);
    const projects = data.projects.filter((p) => p.goalId === entityId);
    const savings = data.savingsGoals.find((s) => s.id === goal.savingsGoalId);

    const totalItems = linkedTasks.length + habits.length + learning.length + projects.length + (savings ? 1 : 0);
    if (totalItems === 0) return null;

    return (
      <div className="panel-flat mb-16">
        <div className="flex flex-wrap" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="small bold">Related Across Growth OS</div>
          <span className="badge tiny">{totalItems} connected</span>
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          {linkedTasks.length > 0 && (
            <div>
              <div className="tiny muted bold mb-4">Tasks ({openTasks.length} open, {doneTasks.length} done)</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                {linkedTasks.slice(0, 3).map((t) => (
                  <li key={t.id} style={{ textDecoration: t.done ? 'line-through' : 'none' }}>
                    {t.text} {t.date ? <span className="muted tiny">({t.date})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {habits.length > 0 && (
            <div>
              <div className="tiny muted bold mb-4">Supporting Habits ({habits.length})</div>
              <div className="flex flex-wrap" style={{ gap: 4 }}>
                {habits.map((h) => (
                  <button key={h.id} className="badge btn-ghost tiny" onClick={() => navigate('growth/habits')}>
                    {h.icon} {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {learning.length > 0 && (
            <div>
              <div className="tiny muted bold mb-4">Learning Items ({learning.length})</div>
              <div className="flex flex-wrap" style={{ gap: 4 }}>
                {learning.map((l) => (
                  <button key={l.id} className="badge btn-ghost tiny" onClick={() => navigate('growth/learning')}>
                    ◈ {l.title} ({l.progress}%)
                  </button>
                ))}
              </div>
            </div>
          )}

          {savings && (
            <div>
              <div className="tiny muted bold mb-4">Money / Savings Target</div>
              <div className="small">
                <strong>{savings.name}</strong>: {formatMoney(savings.currentAmount, currency, true)} / {formatMoney(savings.targetAmount, currency, true)}
                <button className="badge btn-ghost tiny ml-8" onClick={() => navigate('money/goals')}>
                  Open Savings
                </button>
              </div>
            </div>
          )}

          {projects.length > 0 && (
            <div>
              <div className="tiny muted bold mb-4">Projects ({projects.length})</div>
              <div className="flex flex-wrap" style={{ gap: 4 }}>
                {projects.map((p) => (
                  <button key={p.id} className="badge btn-ghost tiny" onClick={() => navigate('growth/career')}>
                    📁 {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (entityType === 'project') {
    const project = data.projects.find((p) => p.id === entityId);
    if (!project) return null;
    const linkedGoal = data.goals.find((g) => g.id === project.goalId);
    const achievements = data.achievements.filter((a) => a.projectId === entityId);

    return (
      <div className="panel-flat mb-16">
        <div className="small bold mb-8">Related Context</div>
        {linkedGoal && (
          <div className="small mb-4">
            Supports Goal:{' '}
            <button className="badge btn-ghost tiny" onClick={() => navigate(`goals/${linkedGoal.id}`)}>
              ◎ {linkedGoal.title}
            </button>
          </div>
        )}
        {achievements.length > 0 && (
          <div className="small">
            Achievements ({achievements.length}):{' '}
            {achievements.map((a) => a.description).join(', ')}
          </div>
        )}
      </div>
    );
  }

  if (entityType === 'person') {
    const person = (data.people ?? []).find((p) => p.id === entityId);
    if (!person) return null;
    const sources = (data.sources ?? []).filter((s) => s.personId === entityId);
    const obligations = (data.obligations ?? []).filter((o) => o.personId === entityId);

    return (
      <div className="panel-flat mb-16">
        <div className="small bold mb-8">Connected Financial Records</div>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <span className="badge">Funds: {sources.length}</span>
          <span className="badge">Obligations: {obligations.length}</span>
        </div>
      </div>
    );
  }

  return null;
}

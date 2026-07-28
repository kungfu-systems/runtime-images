const byId = (id) => document.getElementById(id);
let currentAction = null;

function short(value) {
  if (!value) return '—';
  return value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;
}

function render(state) {
  const view = state.coursework;
  currentAction = view.primaryAction;
  byId('course-title').textContent = view.course.title;
  byId('course-subtitle').textContent = view.course.subtitle;
  byId('progress-label').textContent = `${view.course.lessonsCompleted} of ${view.course.lessonsTotal} lessons`;
  byId('progress-bar').style.width = `${(view.course.lessonsCompleted / view.course.lessonsTotal) * 100}%`;
  byId('homework-title').textContent = view.homework.title;
  byId('homework-instruction').textContent = view.homework.instruction;
  byId('outcome').textContent = view.outcome.label;
  byId('outcome').className = `outcome ${view.outcome.state}`;
  byId('explanation').textContent = view.outcome.explanation;
  byId('simulator-label').textContent = view.simulator.label;
  byId('simulator-copy').textContent = view.simulator.disclosure;

  const submitted = view.submission;
  byId('submission-title').textContent = submitted ? `Round ${submitted.round} claim` : 'No submission yet';
  byId('submission-copy').textContent = submitted?.statement || 'The simulator is ready to make its first completion claim.';
  byId('review-title').textContent = view.independentCheck
    ? view.independentCheck.verdict === 'fit' ? 'Accepted' : 'Evidence insufficient'
    : 'Waiting';
  byId('review-copy').textContent = view.independentCheck?.summary
    || 'A separate reviewer will inspect evidence, not trust the Agent’s words.';

  const satisfied = view.evidence.state === 'satisfied';
  byId('sections-check').textContent = satisfied ? '✓' : '○';
  byId('objectives-check').textContent = satisfied ? '✓' : '○';
  byId('evidence-check').textContent = satisfied ? '✓' : view.evidence.state === 'missing' ? '!' : '○';
  byId('lesson-evidence').className = view.course.lessonsCompleted >= 2 ? 'done' : 'current';
  byId('lesson-review').className = view.course.lessonsCompleted >= 3 ? 'done' : '';

  const button = byId('primary-action');
  button.hidden = !currentAction;
  button.textContent = currentAction?.label || '';
  button.disabled = false;
  byId('timeline').replaceChildren(...view.timeline.map((row) => {
    const item = document.createElement('li');
    item.className = row.state;
    item.innerHTML = `<span></span><p>${row.label}</p>`;
    return item;
  }));

  const roots = {
    'Assignment': view.audit.assignmentId,
    'Evidence Episodes': view.audit.evidenceEpisodeIds.join(', ') || 'None yet',
    'Query proof root': short(view.audit.queryProofRoot),
    'Artifact root': short(view.audit.artifactRoot),
    'Portable state root': short(view.audit.stateRoot),
  };
  byId('audit-roots').replaceChildren(...Object.entries(roots).flatMap(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    return [term, detail];
  }));
  byId('status').textContent = `${view.outcome.label} · local course state is saved automatically`;
  byId('raw').textContent = JSON.stringify(state, null, 2);
}

async function load() {
  byId('status').textContent = 'Reading your saved course state…';
  const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
  const state = await response.json();
  if (!response.ok) throw new Error(state.message || 'State request failed');
  render(state);
}

byId('refresh').addEventListener('click', () => load().catch(showError));
byId('primary-action').addEventListener('click', async () => {
  if (!currentAction) return;
  const button = byId('primary-action');
  button.disabled = true;
  byId('status').textContent = currentAction.id === 'submit-claim'
    ? 'The Agent is claiming completion; the independent reviewer is checking evidence…'
    : 'The Agent is creating evidence; a fresh independent review will follow…';
  const path = currentAction.id === 'submit-claim'
    ? '/api/coursework/claim'
    : '/api/coursework/evidence';
  try {
    const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Coursework action failed');
    render(payload);
  } catch (error) {
    showError(error);
    button.disabled = false;
  }
});

function showError(error) {
  byId('status').textContent = `Blocked: ${error.message}`;
}

load().catch(showError);

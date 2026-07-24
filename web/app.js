const byId = (id) => document.getElementById(id);

function short(value) {
  if (!value) return '—';
  return value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;
}

async function load() {
  byId('status').textContent = 'Reading proof-bound state…';
  const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
  const state = await response.json();
  if (!response.ok) throw new Error(state.message || 'State request failed');
  const assignment = state.assignment.assignment;
  byId('initiative').textContent = state.assignment.initiative_id;
  byId('initiative-root').textContent = short(assignment.initiative_ref?.version_root);
  byId('assignment').textContent = assignment.title;
  byId('assignment-root').textContent = short(assignment.work_definition_root);
  byId('episodes').textContent = String(state.episodes.episodes?.length || state.instance ? state.assignment.phase_transitions.length + 2 : 0);
  byId('query-root').textContent = short(state.assignment.query_proof_root);
  byId('settlement').textContent = state.settlement ? state.settlement.verdict : 'Open';
  byId('state-root').textContent = short(state.settlement?.stateRoot || 'Not sealed');
  byId('status').textContent = `${state.assignment.phase} · instance ${state.instance.label} · ${state.instance.instanceId}`;
  byId('raw').textContent = JSON.stringify(state, null, 2);
}

byId('refresh').addEventListener('click', () => load().catch(showError));
byId('settle').addEventListener('click', async () => {
  byId('settle').disabled = true;
  byId('status').textContent = 'Writing claim, independent review, decision, and seal…';
  try {
    const response = await fetch('/api/settle', { method: 'POST', headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Settlement failed');
    await load();
  } catch (error) {
    showError(error);
  } finally {
    byId('settle').disabled = false;
  }
});

function showError(error) {
  byId('status').textContent = `Blocked: ${error.message}`;
}

load().catch(showError);

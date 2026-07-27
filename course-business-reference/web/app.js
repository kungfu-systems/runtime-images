import { randomUuid } from './random-uuid.js';

const app = document.querySelector('#app');
const account = document.querySelector('#account');
let session = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body && typeof options.body !== 'string') {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  if (session?.csrfToken && options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = session.csrfToken;
  }
  const response = await fetch(path, { ...options, headers });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed');
  return value;
}

function idempotencyKey(action) {
  return `${action}:${randomUuid()}`;
}

function showAuth(message = '') {
  account.innerHTML = '';
  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">A minimum commercial Builder pattern</p>
        <h1>Your customer model stays yours.<br><em>Agent work sits behind a port.</em></h1>
        <p class="lede">Register a learner, receive a private homework, and complete a two-round simulated Agent workflow backed by PostgreSQL.</p>
      </div>
      <div class="authority-card">
        <h2>Two explicit authorities</h2>
        <dl>
          <dt>PostgreSQL</dt><dd>accounts, sessions, courses, enrollments, ownership, delivery intent</dd>
          <dt>AgentWorkPort</dt><dd>execution, evidence, review, outcome, seal</dd>
        </dl>
      </div>
    </section>
    <section class="auth-grid">
      <form id="register" class="panel">
        <p class="step">New learner</p>
        <h2>Create your workspace</h2>
        <label>Name <input name="displayName" autocomplete="name" maxlength="80" required></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        <small>Use 12–128 UTF-8 bytes. This development instance does not provide recovery.</small>
        <button type="submit">Register and enter course</button>
      </form>
      <form id="login" class="panel secondary">
        <p class="step">Returning learner</p>
        <h2>Continue your homework</h2>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Log in</button>
      </form>
    </section>
    <p id="auth-error" class="error">${escapeHtml(message)}</p>`;
  for (const mode of ['register', 'login']) {
    document.querySelector(`#${mode}`).addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try {
        session = await request(`/api/${mode}`, { method: 'POST', body: data });
        await showDashboard();
      } catch (error) {
        document.querySelector('#auth-error').textContent = error.message;
      }
    });
  }
}

async function showDashboard() {
  const value = await request('/api/homeworks');
  account.innerHTML = `
    <span>${escapeHtml(session.user.displayName)}</span>
    <button id="logout" class="text-button">Log out</button>`;
  document.querySelector('#logout').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST', body: {} });
    session = null;
    showAuth();
  });
  app.innerHTML = `
    <section class="dashboard-head">
      <div><p class="eyebrow">Your private learner account</p><h1>One course. One visible homework.</h1></div>
      <p>Other learners' homework IDs return the same generic 404 and remain blocked by PostgreSQL row policies.</p>
    </section>
    <section class="homework-list">
      ${value.homeworks.map((item) => `
        <button class="homework-card" data-id="${item.id}">
          <span class="status">${escapeHtml(item.status.replaceAll('_', ' '))}</span>
          <p>${escapeHtml(item.course_title)}</p>
          <h2>${escapeHtml(item.title)}</h2>
          <span>Open homework →</span>
        </button>`).join('')}
    </section>`;
  for (const button of document.querySelectorAll('.homework-card')) {
    button.addEventListener('click', () => showHomework(button.dataset.id));
  }
}

function actionPanel(homework) {
  const work = homework.agentWork;
  if (!work) return '<p class="notice">Provisioning the simulated work…</p>';
  const action = work.allowedActions[0];
  if (action === 'run_first_submission') {
    return '<button class="primary-action" data-action="first-submission">Run first simulated submission</button>';
  }
  if (action === 'submit_evidence') {
    return `
      <form id="evidence-form" class="evidence-form">
        <label>Artifact title <input name="title" value="AI Course Builder outline" required></label>
        <label>Course outline
          <textarea name="content" rows="9" required>Audience: small-business course creators
Outcome: publish a testable three-module course plan
Module 1: define the learner and business outcome
Module 2: design the smallest useful curriculum
Module 3: validate with a real learner
Observable exercise: produce and review one course outline</textarea>
        </label>
        <button type="submit">Submit outline evidence</button>
      </form>`;
  }
  if (action === 'request_review') {
    return '<button class="primary-action" data-action="review">Run fresh simulated review</button>';
  }
  if (action === 'seal') {
    return '<button class="primary-action" data-action="seal">Seal simulated result</button>';
  }
  return '<p class="success">The simulated golden path is complete.</p>';
}

async function showHomework(id, message = '') {
  const { homework } = await request(`/api/homeworks/${id}`);
  const work = homework.agentWork;
  app.innerHTML = `
    <button id="back" class="back">← All homework</button>
    <section class="work-layout">
      <article>
        <p class="eyebrow">${escapeHtml(homework.courseTitle)}</p>
        <h1>${escapeHtml(homework.title)}</h1>
        <p class="lede">${escapeHtml(homework.brief)}</p>
        <div class="requirement"><strong>Required artifact</strong><p>${escapeHtml(homework.requiredArtifact)}</p></div>
        <p id="work-message" class="error">${escapeHtml(message)}</p>
        <section class="action-box">
          <span class="status">${escapeHtml((work?.status ?? homework.status).replaceAll('_', ' '))}</span>
          <h2>${escapeHtml(work?.nextAction ?? 'Work complete')}</h2>
          ${actionPanel(homework)}
        </section>
      </article>
      <aside class="audit-panel">
        <h2>Progressive audit details</h2>
        <p class="mock-label">Every item below is simulated.</p>
        ${(work?.audit ?? []).map((item) => `
          <details>
            <summary>${escapeHtml(item.type)} · ${escapeHtml(item.outcome ?? item.label)}</summary>
            <p>${escapeHtml(item.detail)}</p>
          </details>`).join('') || '<p>No Agent-work events yet.</p>'}
        ${(work?.evidence ?? []).map((item) => `
          <details>
            <summary>artifact · ${escapeHtml(item.title)}</summary>
            <pre>${escapeHtml(item.content)}</pre>
          </details>`).join('')}
        <dl class="technical">
          <dt>Contract</dt><dd>${escapeHtml(work?.contract ?? 'pending')}</dd>
          <dt>Binding</dt><dd>${escapeHtml(work?.bindingId ?? 'pending')}</dd>
          <dt>Transition</dt><dd>${escapeHtml(work?.transitionId ?? 'pending')}</dd>
        </dl>
      </aside>
    </section>`;
  document.querySelector('#back').addEventListener('click', showDashboard);
  const button = document.querySelector('[data-action]');
  if (button) button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await request(`/api/homeworks/${id}/actions/${button.dataset.action}`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey(button.dataset.action) },
        body: {},
      });
      await showHomework(id);
    } catch (error) {
      await showHomework(id, error.message);
    }
  });
  document.querySelector('#evidence-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button');
    submit.disabled = true;
    try {
      await request(`/api/homeworks/${id}/actions/evidence`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey('evidence') },
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      await showHomework(id);
    } catch (error) {
      await showHomework(id, error.message);
    }
  });
}

try {
  session = await request('/api/session');
  if (session.authenticated) await showDashboard();
  else showAuth();
} catch (error) {
  showAuth(error.message);
}

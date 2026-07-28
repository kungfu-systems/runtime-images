import { randomUuid } from './random-uuid.js';

const app = document.querySelector('#app');
const account = document.querySelector('#account');
const backendBanner = document.querySelector('#backend-banner');
const runtimeMenu = document.querySelector('#runtime-menu');
const workControlMenu = document.querySelector('#work-control-menu');
let session = null;
let runtimeState = {
  defaultBackend: 'mock',
  backends: {},
  workControl: {
    mode: 'app-only',
    label: 'App-only coordination',
    nativeCourseBinding: false,
    hubStarterDemo: { configured: false, reachable: false, ready: false },
  },
};
let selectedBackend = localStorage.getItem('course-agent-backend') || 'mock';
let runtimeMenuOpen = false;
let workControlMenuOpen = false;
let runtimePoll = null;
let backendState = {
  kind: 'mock',
  label: 'Visible Mock Agent',
  provider: 'deterministic simulation',
  model: 'none',
  simulated: true,
  delivery: 'bundled',
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function updateBackend(value) {
  if (value) backendState = value;
  backendBanner.classList.toggle('is-real', !backendState.simulated);
  backendBanner.textContent = backendState.simulated
    ? 'Visible Mock Agent · deterministic development simulation · approved versions stay in PostgreSQL'
    : `${backendState.label} · ${backendState.delivery} inference · approved versions stay in PostgreSQL`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  return `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 * 1024 ? 1 : 0)} MB`;
}

function localStatusCopy(local) {
  const model = local?.modelInstall;
  if (!model) return 'This delivery does not include an optional local model.';
  if (model.state === 'not-installed') {
    return `${formatBytes(model.totalBytes)} · downloads only after you click`;
  }
  if (model.state === 'downloading') {
    return `Downloading ${model.progress}% · ${formatBytes(model.bytes)} of ${formatBytes(model.totalBytes)}`;
  }
  if (model.state === 'verifying') return 'Download complete · verifying SHA-256';
  if (model.state === 'installed' && !local.ready) return 'Installed and verified · starting local inference';
  if (model.state === 'installed') return 'Installed, verified, and ready';
  if (model.state === 'error') return model.error || 'Installation needs to be retried.';
  return 'Checking local model status…';
}

function shouldPollRuntime() {
  const local = runtimeState.backends['openai-compatible'];
  return ['downloading', 'verifying', 'checking'].includes(local?.modelInstall?.state)
    || (local?.modelInstall?.state === 'installed' && !local.ready);
}

function scheduleRuntimePoll() {
  if (runtimePoll) clearTimeout(runtimePoll);
  runtimePoll = shouldPollRuntime()
    ? setTimeout(() => refreshRuntime({ keepOpen: true }).catch(() => {}), 1_000)
    : null;
}

function initializeRuntimeMenu() {
  if (runtimeMenu.dataset.initialized) return;
  runtimeMenu.innerHTML = `
    <button class="runtime-trigger" data-runtime-toggle aria-expanded="false">
      <span class="runtime-dot mock"></span>
      <span class="runtime-trigger-label">AI: Mock</span>
      <span aria-hidden="true">⌄</span>
    </button>
    <section class="runtime-popover" aria-label="AI runtime">
      <p class="step">AI runtime for new courses</p>
      <h2>Choose how drafts are made</h2>
      <button class="runtime-choice" data-runtime-select="mock">
        <span><strong>Mock</strong><small>Instant deterministic simulation · no model download</small></span>
        <em data-runtime-mock-action>Use mock</em>
      </button>
      <div class="runtime-install" data-runtime-install-panel hidden>
        <div><strong>Local model</strong><small data-runtime-local-install-status></small></div>
        <button data-runtime-install>Download & install</button>
        <small data-runtime-auth-note hidden>Log in before installing on this instance.</small>
        <progress data-runtime-progress max="100" value="0" hidden></progress>
      </div>
      <button class="runtime-choice" data-runtime-local-choice data-runtime-select="openai-compatible" hidden>
        <span><strong>Local model</strong><small data-runtime-local-choice-status></small></span>
        <em data-runtime-local-action>Use local</em>
      </button>
      <p class="runtime-note">This header sets the default for new courses. Open a course to view or switch its own current model binding.</p>
    </section>`;
  runtimeMenu.dataset.initialized = 'true';
}

function renderRuntimeMenu() {
  initializeRuntimeMenu();
  const mock = runtimeState.backends.mock ?? backendState;
  const local = runtimeState.backends['openai-compatible'];
  const selected = runtimeState.backends[selectedBackend] ?? mock;
  updateBackend(selected);
  const installed = local?.modelInstall?.state === 'installed';
  const installing = ['downloading', 'verifying', 'checking'].includes(
    local?.modelInstall?.state,
  );

  const trigger = runtimeMenu.querySelector('[data-runtime-toggle]');
  const triggerDot = runtimeMenu.querySelector('.runtime-dot');
  const triggerLabel = runtimeMenu.querySelector('.runtime-trigger-label');
  const popover = runtimeMenu.querySelector('.runtime-popover');
  const mockChoice = runtimeMenu.querySelector('[data-runtime-select="mock"]');
  const mockAction = runtimeMenu.querySelector('[data-runtime-mock-action]');
  const installPanel = runtimeMenu.querySelector('[data-runtime-install-panel]');
  const installStatus = runtimeMenu.querySelector('[data-runtime-local-install-status]');
  const installButton = runtimeMenu.querySelector('[data-runtime-install]');
  const authNote = runtimeMenu.querySelector('[data-runtime-auth-note]');
  const progress = runtimeMenu.querySelector('[data-runtime-progress]');
  const localChoice = runtimeMenu.querySelector('[data-runtime-local-choice]');
  const localChoiceStatus = runtimeMenu.querySelector('[data-runtime-local-choice-status]');
  const localAction = runtimeMenu.querySelector('[data-runtime-local-action]');

  trigger.classList.toggle('active', runtimeMenuOpen);
  trigger.setAttribute('aria-expanded', String(runtimeMenuOpen));
  triggerDot.classList.toggle('mock', selectedBackend === 'mock');
  triggerDot.classList.toggle('local', selectedBackend !== 'mock');
  triggerLabel.textContent = `AI: ${selectedBackend === 'mock' ? 'Mock' : 'Local model'}`;
  popover.classList.toggle('open', runtimeMenuOpen);
  mockChoice.classList.toggle('selected', selectedBackend === 'mock');
  mockAction.textContent = selectedBackend === 'mock' ? 'In use' : 'Use mock';

  installPanel.hidden = !local || installed;
  localChoice.hidden = !local || !installed;
  if (local) {
    const status = localStatusCopy(local);
    installStatus.textContent = status;
    localChoiceStatus.textContent = status;
    installButton.disabled = installing || !session?.authenticated;
    installButton.textContent = installing ? `${local.modelInstall.progress}%` : 'Download & install';
    authNote.hidden = Boolean(session?.authenticated);
    progress.hidden = !installing;
    progress.value = local.modelInstall.progress ?? 0;
    localChoice.disabled = !local.ready;
    localChoice.classList.toggle('selected', selectedBackend === 'openai-compatible');
    localAction.textContent = local.ready
      ? (selectedBackend === 'openai-compatible' ? 'In use' : 'Use local')
      : 'Starting…';
  }
  scheduleRuntimePoll();
}

function initializeWorkControlMenu() {
  if (workControlMenu.dataset.initialized) return;
  workControlMenu.innerHTML = `
    <button class="runtime-trigger work-control-trigger" data-work-control-toggle aria-expanded="false">
      <span class="runtime-dot control"></span>
      <span>Work control: App-only</span>
      <span aria-hidden="true">⌄</span>
    </button>
    <section class="runtime-popover work-control-popover" aria-label="Work control">
      <p class="step">Work control for this course app</p>
      <h2>Generation works. Kungfu is not connected yet.</h2>
      <div class="control-menu-state">
        <span class="control-state-mark">NOW</span>
        <div>
          <strong>PostgreSQL + application outbox</strong>
          <small>The app delegates, retries, saves versions, and records your approval.</small>
        </div>
      </div>
      <div class="control-menu-state future">
        <span class="control-state-mark">KF</span>
        <div>
          <strong>Kungfu-managed work</strong>
          <small>Adds a native Assignment, evidence, independent review, typed decisions, recovery, and a state seal.</small>
        </div>
      </div>
      <div data-hub-demo-status></div>
      <p class="runtime-note">Kungfu does not write the course outline. It makes the delegated work accountable and independently checkable.</p>
    </section>`;
  workControlMenu.dataset.initialized = 'true';
}

function renderHubDemoStatus(container) {
  const demo = runtimeState.workControl?.hubStarterDemo ?? {};
  if (!demo.configured) {
    container.innerHTML = `
      <p class="hub-demo-status unavailable">
        <strong>Real Kungfu walkthrough</strong>
        <span>No neighboring Hub Starter URL is configured for this deployment.</span>
      </p>`;
    return;
  }
  const state = demo.ready ? 'ready' : demo.reachable ? 'checking' : 'unavailable';
  const label = demo.ready
    ? `Ready · phase ${demo.phase}`
    : demo.reachable
      ? `Reachable · phase ${demo.phase}`
      : 'Currently unavailable';
  container.innerHTML = `
    <div class="hub-demo-status ${state}">
      <div>
        <strong>Real Kungfu walkthrough</strong>
        <span>${escapeHtml(label)} · separate from this course</span>
      </div>
      <a href="${escapeHtml(demo.browserUrl)}" target="_blank" rel="noopener">Open ↗</a>
    </div>`;
}

function renderWorkControlMenu() {
  initializeWorkControlMenu();
  const trigger = workControlMenu.querySelector('[data-work-control-toggle]');
  const popover = workControlMenu.querySelector('.work-control-popover');
  trigger.classList.toggle('active', workControlMenuOpen);
  trigger.setAttribute('aria-expanded', String(workControlMenuOpen));
  popover.classList.toggle('open', workControlMenuOpen);
  renderHubDemoStatus(workControlMenu.querySelector('[data-hub-demo-status]'));
}

workControlMenu.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-work-control-toggle]');
  if (!toggle) return;
  event.stopPropagation();
  workControlMenuOpen = !workControlMenuOpen;
  runtimeMenuOpen = false;
  renderRuntimeMenu();
  renderWorkControlMenu();
});

function updateSelectedRuntimePanels() {
  const runtime = backendPresentation(selectedBackend);
  const dashboard = app.querySelector('[data-selected-runtime-panel="dashboard"]');
  if (dashboard) {
    dashboard.className = `runtime-context ${runtime.tone}`;
    dashboard.querySelector('[data-selected-runtime-mark]').textContent =
      runtime.simulated ? 'MOCK' : 'AI';
    dashboard.querySelector('[data-selected-runtime-name]').textContent = runtime.name;
    dashboard.querySelector('[data-selected-runtime-copy]').textContent = runtime.simulated
      ? 'New courses use a deterministic simulation. Choose Local model in the header to create a course whose drafts come from real local inference.'
      : 'New courses will generate their outlines with Qwen3 0.6B inside this Docker deployment. Each course can later switch its own model.';
  }
  const newCourse = app.querySelector('[data-selected-runtime-panel="new-course"]');
  if (newCourse) {
    newCourse.className = `new-course-runtime ${runtime.tone}`;
    newCourse.querySelector('[data-selected-runtime-mark]').textContent =
      runtime.simulated ? 'MOCK' : 'LOCAL AI';
    newCourse.querySelector('[data-selected-runtime-name]').textContent = runtime.name;
    newCourse.querySelector('[data-selected-runtime-copy]').textContent = runtime.simulated
      ? 'Its outline will be a deterministic reference result, clearly labeled as Mock.'
      : 'Qwen3 0.6B will generate the outline locally inside this Docker deployment.';
  }
  const courseNotice = app.querySelector('[data-course-runtime-notice]');
  if (courseNotice) {
    const courseRuntime = backendPresentation(courseNotice.dataset.courseBackend);
    const differs = selectedBackend !== courseRuntime.kind;
    courseNotice.hidden = !differs;
    courseNotice.className = `course-runtime-notice ${runtime.tone}`;
    courseNotice.querySelector('strong').textContent =
      `${runtime.short} is selected for new courses.`;
    courseNotice.querySelector('span').textContent =
      `This course currently uses ${courseRuntime.short}. Switch it in the Current course model panel; saved versions keep their original source.`;
  }
}

async function refreshRuntime({ keepOpen = false } = {}) {
  const { runtime } = await request('/api/runtime');
  runtimeState = runtime;
  if (!runtimeState.backends[selectedBackend]) {
    selectedBackend = runtime.defaultBackend;
    localStorage.setItem('course-agent-backend', selectedBackend);
  }
  if (
    selectedBackend === 'openai-compatible'
    && runtimeState.backends[selectedBackend]?.modelInstall?.state !== 'installed'
  ) {
    selectedBackend = 'mock';
    localStorage.setItem('course-agent-backend', selectedBackend);
  }
  if (!keepOpen) runtimeMenuOpen = false;
  renderRuntimeMenu();
  renderWorkControlMenu();
}

function selectRuntime(kind) {
  const backend = runtimeState.backends[kind];
  if (!backend?.ready) return;
  selectedBackend = kind;
  localStorage.setItem('course-agent-backend', kind);
  runtimeMenuOpen = false;
  renderRuntimeMenu();
  updateSelectedRuntimePanels();
}

runtimeMenu.addEventListener('click', async (event) => {
  event.stopPropagation();
  const toggle = event.target.closest('[data-runtime-toggle]');
  if (toggle) {
    runtimeMenuOpen = !runtimeMenuOpen;
    workControlMenuOpen = false;
    renderRuntimeMenu();
    renderWorkControlMenu();
    return;
  }
  const choice = event.target.closest('[data-runtime-select]');
  if (choice) {
    selectRuntime(choice.dataset.runtimeSelect);
    return;
  }
  const install = event.target.closest('[data-runtime-install]');
  if (install && !install.disabled) {
    install.disabled = true;
    try {
      await request('/api/runtime/local-model/install', { method: 'POST', body: {} });
      runtimeMenuOpen = true;
      await refreshRuntime({ keepOpen: true });
    } catch {
      await refreshRuntime({ keepOpen: true });
    }
  }
});

document.addEventListener('click', () => {
  if (!runtimeMenuOpen && !workControlMenuOpen) return;
  runtimeMenuOpen = false;
  workControlMenuOpen = false;
  renderRuntimeMenu();
  renderWorkControlMenu();
});

function activeAgentLabel() {
  return backendState.label || (backendState.simulated ? 'Visible Mock Agent' : 'Course Designer');
}

function courseAgentLabel(course, selected = null) {
  return selected?.outline?.agentContribution?.role
    || (course.agentWork?.simulated ? 'Mock Course Designer' : activeAgentLabel());
}

function currentCourseAgentLabel(course) {
  if (course.backendKind === 'mock') return 'Mock Course Designer';
  return runtimeState.backends[course.backendKind]?.label || 'Local Qwen Course Designer';
}

function backendPresentation(kind) {
  if (kind === 'openai-compatible') {
    const backend = runtimeState.backends[kind];
    return {
      kind: 'openai-compatible',
      short: 'Local AI',
      badge: 'Local AI course',
      name: backend?.model
        ? `Local Qwen · ${backend.model}`
        : 'Local Qwen · Qwen3 0.6B',
      tone: 'local',
      simulated: false,
      ready: Boolean(backend?.ready),
    };
  }
  return {
    kind: 'mock',
    short: 'Mock',
    badge: 'Mock course',
    name: 'Deterministic Mock Agent',
    tone: 'mock',
    simulated: true,
    ready: true,
  };
}

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

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function wireTabPlaceholderAcceptance(root) {
  for (const field of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    field.addEventListener('keydown', (event) => {
      if (
        event.key !== 'Tab'
        || event.shiftKey
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || field.value.trim()
      ) return;
      field.value = field.placeholder;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.classList.remove('tab-accepted');
      void field.offsetWidth;
      field.classList.add('tab-accepted');
      setTimeout(() => field.classList.remove('tab-accepted'), 650);
    });
  }
}

function updateWorkflowProgress(overlay, activeIndex) {
  for (const [index, dot] of [...overlay.querySelectorAll('.workflow-dot')].entries()) {
    dot.classList.toggle('is-complete', index < activeIndex);
    dot.classList.toggle('is-active', index === activeIndex);
  }
}

async function showWorkflowStep(overlay, index, total, text, tone = 'active') {
  const stage = overlay.querySelector('.workflow-stage');
  if (stage.hasChildNodes()) {
    stage.classList.add('is-leaving');
    await wait(240);
  }
  stage.className = `workflow-stage workflow-${tone}`;
  stage.innerHTML = `
    <span>${tone === 'waiting' ? '…' : String(index + 1).padStart(2, '0')}</span>
    <div>
      <small>${tone === 'active'
        ? `Step ${index + 1} of ${total}`
        : tone === 'waiting'
          ? 'Confirming result'
          : 'Workflow result'}</small>
      <strong>${escapeHtml(text)}</strong>
    </div>`;
  updateWorkflowProgress(
    overlay,
    ['active', 'waiting'].includes(tone) ? Math.min(index, total - 1) : total,
  );
  void stage.offsetWidth;
  stage.classList.add('is-entering');
  await wait(stage.dataset.initialized ? 760 : 1000);
  stage.dataset.initialized = 'true';
  stage.classList.remove('is-entering');
}

async function runVisibleWorkflow({
  eyebrow = `Visible workflow · ${activeAgentLabel()}`,
  title,
  steps,
  success,
  task,
}) {
  const overlay = document.createElement('section');
  overlay.className = 'workflow-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'workflow-title');
  overlay.innerHTML = `
    <div class="workflow-card">
      <p class="step">${escapeHtml(eyebrow)}</p>
      <h2 id="workflow-title">${escapeHtml(title)}</h2>
      <p class="workflow-copy">These are the application’s visible lifecycle stages, not hidden model reasoning.</p>
      <div class="workflow-dots" aria-hidden="true">
        ${steps.map(() => '<span class="workflow-dot"></span>').join('')}
      </div>
      <div class="workflow-stage" aria-live="polite"></div>
    </div>`;
  document.body.append(overlay);
  void overlay.offsetWidth;
  overlay.classList.add('is-visible');
  overlay.querySelector('.workflow-card').setAttribute('tabindex', '-1');
  overlay.querySelector('.workflow-card').focus();

  let settledOutcome = null;
  const outcomePromise = Promise.resolve()
    .then(task)
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
  outcomePromise.then((outcome) => { settledOutcome = outcome; });

  for (const [index, step] of steps.entries()) {
    await showWorkflowStep(overlay, index, steps.length, step);
    if (settledOutcome && !settledOutcome.ok) break;
  }
  if (!settledOutcome) {
    await showWorkflowStep(
      overlay,
      steps.length,
      steps.length,
      'Waiting for the course service to confirm the result…',
      'waiting',
    );
  }
  const outcome = settledOutcome ?? await outcomePromise;
  await showWorkflowStep(
    overlay,
    steps.length,
    steps.length,
    outcome.ok ? success : `Stopped: ${outcome.error.message}`,
    outcome.ok ? 'success' : 'error',
  );
  overlay.classList.add('is-closing');
  await wait(320);
  overlay.remove();
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

function wireAccount() {
  account.innerHTML = `
    <span>${escapeHtml(session.user.displayName)}</span>
    <button id="logout" class="text-button">Log out</button>`;
  document.querySelector('#logout').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST', body: {} });
    session = null;
    renderRuntimeMenu();
    showAuth();
  });
}

function showAuth(message = '') {
  account.innerHTML = '';
  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">Course Outline Copilot</p>
        <h1>Turn your expertise into a course people can <em>actually finish.</em></h1>
        <p class="lede">Describe who you teach and the result you promise. ${escapeHtml(activeAgentLabel())} turns that brief into a visible outline you can review, improve, and approve.</p>
        <div class="flow-strip">
          <span>1 · Brief</span><span>2 · Agent draft</span><span>3 · Your feedback</span><span>4 · Approved version</span>
        </div>
      </div>
      <div class="authority-card">
        <p class="step">Why an Agent?</p>
        <h2>It performs the messy thinking, not your business ownership.</h2>
        <p>PostgreSQL keeps your account, course collection, and approved versions. The replaceable Agent turns ambiguous expertise into drafts and revisions.</p>
      </div>
    </section>
    <section class="auth-grid">
      <form id="register" class="panel">
        <p class="step">New creator</p>
        <h2>Create your private course workspace</h2>
        <label>Name <input name="displayName" autocomplete="name" maxlength="80" required></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        <small>Development instance: use synthetic information. Account recovery is not included.</small>
        <button type="submit">Create my workspace</button>
      </form>
      <form id="login" class="panel secondary">
        <p class="step">Returning creator</p>
        <h2>Continue building your courses</h2>
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
        await refreshRuntime();
        await showCourses();
      } catch (error) {
        document.querySelector('#auth-error').textContent = error.message;
      }
    });
  }
}

function courseCard(course) {
  const versionLabel = course.version_count
    ? `${course.version_count} saved ${course.version_count === 1 ? 'version' : 'versions'}`
    : 'Ready for a first draft';
  const runtime = backendPresentation(course.backend_kind);
  return `
    <button class="course-card" data-course-id="${course.id}">
      <div class="course-card-badges">
        <span class="status">${course.current_outline_version_id ? 'approved course' : 'course in progress'}</span>
        <span class="course-backend ${runtime.tone}">${escapeHtml(runtime.badge)}</span>
      </div>
      <h2>${escapeHtml(course.title)}</h2>
      <p>For ${escapeHtml(course.target_learner)}</p>
      <div class="card-footer"><span>${escapeHtml(versionLabel)}</span><strong>Open course →</strong></div>
    </button>`;
}

async function showCourses(message = '') {
  wireAccount();
  const { courses } = await request('/api/courses');
  const runtime = backendPresentation(selectedBackend);
  app.innerHTML = `
    <section class="dashboard-head">
      <div>
        <p class="eyebrow">Your course collection</p>
        <h1>Every course has its own evolving outline.</h1>
      </div>
      <button id="new-course" class="primary-action">Create a new course</button>
    </section>
    <p class="dashboard-copy">Generating again does not create another course or overwrite your work. It appends a new version inside the same course.</p>
    <section class="runtime-context ${runtime.tone}" data-selected-runtime-panel="dashboard">
      <span class="runtime-context-mark" data-selected-runtime-mark>${runtime.simulated ? 'MOCK' : 'AI'}</span>
      <div>
        <p class="step">Runtime selected for your next course</p>
        <h2 data-selected-runtime-name>${escapeHtml(runtime.name)}</h2>
        <p data-selected-runtime-copy>${runtime.simulated
          ? 'New courses use a deterministic simulation. Choose Local model in the header to create a course whose drafts come from real local inference.'
          : 'New courses will generate their outlines with Qwen3 0.6B inside this Docker deployment. Each course can later switch its own model.'}</p>
      </div>
    </section>
    <p class="success">${escapeHtml(message)}</p>
    <section class="course-list">
      ${courses.map(courseCard).join('') || `
        <div class="empty-state">
          <p class="step">Your collection is empty</p>
          <h2>Start with one course promise.</h2>
          <p>The Agent needs a real learner, a real problem, and a result worth teaching.</p>
        </div>`}
    </section>`;
  document.querySelector('#new-course').addEventListener('click', () => showNewCourse());
  for (const button of document.querySelectorAll('[data-course-id]')) {
    button.addEventListener('click', () => showCourse(button.dataset.courseId));
  }
}

function showNewCourse(message = '') {
  const runtime = backendPresentation(selectedBackend);
  app.innerHTML = `
    <button id="back" class="back">← My courses</button>
    <section class="editor-head">
      <p class="eyebrow">Create a course project</p>
      <h1>Give the Agent a useful brief.</h1>
      <p class="lede">These are durable business facts. The Agent will use them to generate a draft, but your application owns the brief and every approved version.</p>
    </section>
    <section class="new-course-runtime ${runtime.tone}" data-selected-runtime-panel="new-course">
      <span data-selected-runtime-mark>${runtime.simulated ? 'MOCK' : 'LOCAL AI'}</span>
      <div>
        <p class="step">This course will use</p>
        <h2 data-selected-runtime-name>${escapeHtml(runtime.name)}</h2>
        <p data-selected-runtime-copy>${runtime.simulated
          ? 'Its outline will be a deterministic reference result, clearly labeled as Mock.'
          : 'Qwen3 0.6B will generate the outline locally inside this Docker deployment.'}</p>
      </div>
    </section>
    <form id="course-form" class="brief-form panel">
      <p class="field-shortcut">Tip: focus an empty field and press <kbd>Tab</kbd> to use its example, then continue to the next field.</p>
      <label>Course working title
        <input name="title" maxlength="120" placeholder="AI course creation for small-business experts" required>
      </label>
      <label>Who is the course for?
        <textarea name="targetLearner" rows="2" maxlength="500" placeholder="Small-business owners with valuable expertise but no curriculum-design experience" required></textarea>
      </label>
      <label>What problem are they trying to solve?
        <textarea name="learnerProblem" rows="3" maxlength="1000" placeholder="They know their subject but cannot turn it into a clear learning path people will buy and complete" required></textarea>
      </label>
      <label>What result should they achieve?
        <textarea name="promisedOutcome" rows="3" maxlength="1000" placeholder="Create and validate a sellable three-module course outline in three weeks" required></textarea>
      </label>
      <label>What experience or material do you already have?
        <textarea name="creatorExpertise" rows="3" maxlength="2000" placeholder="Client cases, workshop notes, a repeatable method, and examples from my own business" required></textarea>
      </label>
      <label>What constraints should shape the course?
        <textarea name="deliveryConstraints" rows="2" maxlength="1000" placeholder="Three weeks, one live session per week, practical exercises, no technical background required" required></textarea>
      </label>
      <p id="course-error" class="error">${escapeHtml(message)}</p>
      <button type="submit" class="primary-action">Create course project</button>
    </form>`;
  document.querySelector('#back').addEventListener('click', () => showCourses());
  wireTabPlaceholderAcceptance(document.querySelector('#course-form'));
  document.querySelector('#course-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { course } = await request('/api/courses', {
        method: 'POST',
        body: {
          ...Object.fromEntries(new FormData(event.currentTarget)),
          backendKind: selectedBackend,
        },
      });
      await showCourse(course.id, 'Course created. Your brief is saved.');
    } catch (error) {
      showNewCourse(error.message);
    }
  });
}

function renderSavedBriefSource(course) {
  return `
    <section class="saved-input-source" aria-label="Saved input, not AI generated">
      <div class="source-heading">
        <span class="source-icon" aria-hidden="true">YOU</span>
        <div>
          <p class="step">Input · saved by the course app</p>
          <h2>Your brief — not AI-generated</h2>
          <p>This is the durable business context the app sent to the selected Agent.</p>
        </div>
      </div>
      <dl class="source-grid">
        <div><dt>Working title</dt><dd>${escapeHtml(course.title)}</dd></div>
        <div><dt>Target learner</dt><dd>${escapeHtml(course.brief.targetLearner)}</dd></div>
        <div><dt>Learner problem</dt><dd>${escapeHtml(course.brief.learnerProblem)}</dd></div>
        <div><dt>Promised outcome</dt><dd>${escapeHtml(course.brief.promisedOutcome)}</dd></div>
        <div><dt>Your source material</dt><dd>${escapeHtml(course.brief.creatorExpertise)}</dd></div>
        <div><dt>Delivery constraints</dt><dd>${escapeHtml(course.brief.deliveryConstraints)}</dd></div>
      </dl>
    </section>`;
}

function generatedBadge(runtime) {
  return `<span class="generated-section-badge">${runtime.simulated ? 'System template · no AI' : 'Generated by Local Qwen'}</span>`;
}

function renderOutputBoundary(version, runtime) {
  const inference = version.outline?.inference ?? {};
  const modelName = inference.model || (runtime.simulated ? 'none' : 'Qwen3 0.6B');
  return `
    <div class="output-boundary ${runtime.tone}" role="separator" aria-label="${runtime.simulated ? 'Mock template output starts here' : 'Local AI output starts here'}">
      <span aria-hidden="true">↓</span>
      <div>
        <p>${runtime.simulated ? 'MOCK TEMPLATE OUTPUT STARTS HERE' : 'LOCAL AI OUTPUT STARTS HERE'}</p>
        <strong>${runtime.simulated
          ? 'Everything below is deterministic system template content—not AI inference.'
          : `Everything below was returned by ${escapeHtml(modelName)}, running locally in this deployment.`}</strong>
      </div>
    </div>`;
}

function renderOutline(outline, runtime) {
  return `
    <div class="outline">
      <div class="outline-intro">
        ${generatedBadge(runtime)}
        <p class="eyebrow">Agent's proposed course direction</p>
        <h2>${escapeHtml(outline.title)}</h2>
        <p>${escapeHtml(outline.positioning)}</p>
        <p><strong>Audience interpretation:</strong> ${escapeHtml(outline.audience)}</p>
        <p><strong>Outcome interpretation:</strong> ${escapeHtml(outline.promise)}</p>
        <p><strong>Delivery interpretation:</strong> ${escapeHtml(outline.delivery)}</p>
        <p><strong>How your expertise is used:</strong> ${escapeHtml(outline.creatorAdvantage)}</p>
      </div>
      <div class="module-list">
        ${(outline.modules ?? []).map((module) => `
          <article class="module">
            <span>${escapeHtml(module.number)}</span>
            <div>
              ${generatedBadge(runtime)}
              <h3>${escapeHtml(module.title)}</h3>
              <p>${escapeHtml(module.outcome)}</p>
              <ul>${(module.lessons ?? []).map((lesson) => `<li>${escapeHtml(lesson)}</li>`).join('')}</ul>
              <div class="exercise"><strong>Observable exercise</strong><p>${escapeHtml(module.exercise)}</p></div>
            </div>
          </article>`).join('')}
      </div>
      <div class="questions">
        ${generatedBadge(runtime)}
        <h3>Questions to resolve before publishing</h3>
        <ol>${(outline.openQuestions ?? []).map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>
      </div>
    </div>`;
}

function renderAIOutputHero(version, runtime) {
  const inference = version.outline?.inference ?? {};
  const modelName = inference.model || (runtime.simulated ? 'none' : 'Qwen3 0.6B');
  return `
    <section class="ai-output-hero ${runtime.tone}">
      <div class="ai-output-symbol" aria-hidden="true">${runtime.simulated ? 'M' : 'AI'}</div>
      <div>
        <p class="step">${runtime.simulated ? 'Mock reference output' : 'Local AI generated · Qwen3 0.6B'}</p>
        <h2>${runtime.simulated
          ? 'This draft came from the deterministic simulation—not the local model.'
          : 'The complete course draft below was generated by the local model.'}</h2>
        <p>${runtime.simulated
          ? 'It demonstrates the workflow and data boundary. Switch this course to Local model above, then generate a new version to compare real inference.'
          : 'Module names, outcomes, lessons, exercises, and open questions are model output produced from your saved brief inside this Docker deployment.'}</p>
        <div class="ai-output-facts">
          <span>${runtime.simulated ? 'Deterministic reference' : 'Runs locally in Docker'}</span>
          <span>${escapeHtml(modelName)}</span>
          <span>Saved as immutable version ${version.versionNumber}</span>
        </div>
      </div>
    </section>`;
}

function agentVersionLabel(version) {
  if (version.agentRun?.action === 'revise_outline') return 'Agent revision';
  if (version.agentRun?.previousVersionId) return 'Agent alternative';
  return 'Agent first draft';
}

function renderHandoff(version, isCurrent) {
  const contribution = version.outline.agentContribution ?? {};
  const supplied = version.agentRun?.feedback
    ? `Saved course brief plus your feedback: “${version.agentRun.feedback}”`
    : 'Saved target learner, problem, promise, expertise, and delivery constraints';
  const delegated = version.agentRun?.action === 'revise_outline'
    ? `Revise version ${version.versionNumber - 1} without overwriting it`
    : version.agentRun?.previousVersionId
      ? 'Generate an alternative route from the same saved brief'
      : 'Turn the saved brief into a first teachable outline';
  const delivered = contribution.summary
    ?? (version.agentRun?.action === 'revise_outline'
      ? 'Reworked the prior outline using the creator’s feedback.'
      : version.agentRun?.previousVersionId
        ? 'Generated another outline from the same saved brief.'
        : 'Structured the creator’s brief into a teachable first draft.');
  const agentLabel = contribution.role
    || (version.agentRun?.backend === 'mock' ? 'Mock Course Designer' : 'Course Designer');
  return `
    <section class="handoff-panel">
      <div class="handoff-heading">
        <div>
          <p class="step">Work handoff · version ${version.versionNumber}</p>
          <h2>Who did what?</h2>
        </div>
        <span class="agent-badge">${escapeHtml(agentLabel)}</span>
      </div>
      <ol class="handoff-flow">
        <li>
          <span>1</span>
          <div><strong>You supplied</strong><p>${escapeHtml(supplied)}</p></div>
        </li>
        <li>
          <span>2</span>
          <div><strong>Course app delegated</strong><p>${escapeHtml(delegated)}</p></div>
        </li>
        <li class="agent-step">
          <span>3</span>
          <div><strong>${escapeHtml(agentLabel)} delivered</strong><p>${escapeHtml(delivered)}</p></div>
        </li>
        <li>
          <span>4</span>
          <div><strong>Course app saved</strong><p>Immutable version ${version.versionNumber} in your PostgreSQL course collection</p></div>
        </li>
        <li class="${isCurrent ? 'decision-complete' : ''}">
          <span>5</span>
          <div><strong>You decide</strong><p>${isCurrent
            ? 'Approved as the current business result'
            : 'Review, request another pass, or approve this version'}</p></div>
        </li>
      </ol>
    </section>`;
}

function renderAgentChanges(version, runtime) {
  const contribution = version.outline.agentContribution ?? {};
  const hasStructuredContribution = Boolean(contribution.changes?.length);
  const changes = hasStructuredContribution
    ? contribution.changes
    : [
      version.changeSummary,
      'This earlier version predates structured per-change reporting.',
    ];
  return `
    <section class="agent-changes ${runtime.tone}">
      ${generatedBadge(runtime)}
      <p class="step">What the Agent changed</p>
      <h2>${runtime.simulated ? 'Template change summary' : 'Local Qwen’s own change summary'}</h2>
      <p>${runtime.simulated
        ? 'These bullets are part of the deterministic Mock output.'
        : 'These bullets were written by the local model; they are not system-prefilled copy.'}</p>
      <ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('')}</ul>
    </section>`;
}

function versionButton(version, selectedId) {
  const active = version.id === selectedId ? ' active' : '';
  const runtime = backendPresentation(version.agentRun?.backend);
  return `
    <button class="version-button${active}" data-version-id="${version.id}">
      <span>
        <strong>v${version.versionNumber}</strong>
        <small>${escapeHtml(agentVersionLabel(version))}</small>
        <small class="version-source ${runtime.tone}">${escapeHtml(runtime.short)} source</small>
      </span>
      <em>${escapeHtml(version.status)}</em>
    </button>`;
}

function renderCourseBinding(course, runtime) {
  const local = backendPresentation('openai-compatible');
  const switching = course.backendStatus === 'provisioning';
  const failed = course.backendStatus === 'failed';
  const lastSwitch = course.backendSwitches?.[0];
  return `
    <section class="course-binding-panel ${runtime.tone}" aria-label="Current course model">
      <div class="course-binding-identity">
        <span class="binding-live-mark">${runtime.simulated ? 'MOCK' : 'LOCAL AI'}</span>
        <div>
          <p class="step">Current course model · controls the next Agent action</p>
          <h2>${escapeHtml(runtime.name)}</h2>
          <p>${switching
            ? 'The new binding is being prepared. Generate and Improve unlock when it is ready.'
            : failed
              ? 'The current binding could not initialize. Your brief and saved versions are safe; switch to the other model to recover.'
            : `The next Generate or Improve action will use ${escapeHtml(runtime.short)}.`}</p>
        </div>
      </div>
      <div class="course-binding-switch">
        <p class="step">Switch this course now</p>
        <div class="binding-options" role="group" aria-label="Course model binding">
          <button
            class="binding-option mock${runtime.kind === 'mock' ? ' current' : ''}"
            data-bind-course-backend="mock"
            ${runtime.kind === 'mock' || switching ? 'disabled' : ''}
          >
            <span>Mock</span>
            <small>${runtime.kind === 'mock' ? 'Current binding' : 'Use deterministic reference'}</small>
          </button>
          <button
            class="binding-option local${runtime.kind === 'openai-compatible' ? ' current' : ''}"
            data-bind-course-backend="openai-compatible"
            ${runtime.kind === 'openai-compatible' || switching || !local.ready ? 'disabled' : ''}
          >
            <span>Local model</span>
            <small>${runtime.kind === 'openai-compatible'
              ? 'Current binding'
              : local.ready
                ? 'Use local Qwen'
                : 'Install or start it from the header'}</small>
          </button>
        </div>
        <p class="binding-safety">Only future versions change. Every saved version keeps its original model source and audit trail.</p>
        ${lastSwitch ? `<p class="binding-history">Last switch: ${escapeHtml(backendPresentation(lastSwitch.from).short)} → ${escapeHtml(backendPresentation(lastSwitch.to).short)} · ${lastSwitch.completedAt ? 'ready' : 'provisioning'}</p>` : ''}
      </div>
    </section>`;
}

function renderWorkControlPanel(course, selected, isCurrent) {
  const demo = runtimeState.workControl?.hubStarterDemo ?? {};
  const generated = Boolean(selected);
  const approval = isCurrent
    ? `Version ${selected.versionNumber} approved in PostgreSQL`
    : generated
      ? `Version ${selected.versionNumber} awaits your approval`
      : 'No course version exists yet';
  const hubStatus = demo.configured
    ? demo.ready
      ? `The neighboring Hub Starter is ready in phase “${demo.phase}”.`
      : demo.reachable
        ? `The neighboring Hub Starter is reachable in phase “${demo.phase}”.`
        : 'The neighboring Hub Starter link is configured but is currently unavailable.'
    : 'No neighboring Hub Starter walkthrough is configured.';
  const demoLink = demo.configured
    ? `<a class="hub-demo-link" href="${escapeHtml(demo.browserUrl)}" target="_blank" rel="noopener">Open the real Kungfu walkthrough on this machine ↗</a>`
    : '';
  return `
    <details class="work-control-panel" aria-label="Current work control">
      <summary class="control-panel-heading control-panel-summary">
        <span class="control-summary-copy">
          <span class="step">Work control · current truth</span>
          <span class="control-summary-title">This course is running without Kungfu management.</span>
        </span>
        <span class="control-summary-actions">
          <span class="control-mode-badge">APP-ONLY</span>
          <span class="control-expand-label">
            See what Kungfu adds
            <span class="control-chevron" aria-hidden="true">⌄</span>
          </span>
        </span>
      </summary>
      <div class="work-control-body">
        <p class="control-body-intro">The Agent can generate a useful draft and PostgreSQL can preserve it. What is missing is an independent, native record that proves how delegated work was assigned, evidenced, reviewed, decided, and recovered.</p>
        <ol class="current-control-flow">
          <li class="live">
            <span>1</span>
            <div><strong>Delegated</strong><p>Application outbox command</p></div>
            <em>APP RECORD</em>
          </li>
          <li class="${generated ? 'live' : ''}">
            <span>2</span>
            <div><strong>Agent output</strong><p>${generated ? `Version ${selected.versionNumber} returned` : 'Waiting for Generate'}</p></div>
            <em>${generated ? 'OUTPUT' : 'PENDING'}</em>
          </li>
          <li class="missing">
            <span>3</span>
            <div><strong>Evidence</strong><p>No native Kungfu Evidence Episode</p></div>
            <em>NOT CONNECTED</em>
          </li>
          <li class="missing">
            <span>4</span>
            <div><strong>Independent review</strong><p>Only the creator reviews this version</p></div>
            <em>NOT CONNECTED</em>
          </li>
          <li class="${isCurrent ? 'live' : 'missing'}">
            <span>5</span>
            <div><strong>Decision & recovery</strong><p>${escapeHtml(approval)}; no Kungfu decision or seal</p></div>
            <em>${isCurrent ? 'BUSINESS DECISION' : 'NO SEAL'}</em>
          </li>
        </ol>
        <div class="control-comparison">
          <article>
            <p class="step">Without Kungfu · what you see now</p>
            <h3>The app coordinates its own happy path.</h3>
            <ul>
              <li>Its outbox handles delivery and retries.</li>
              <li>The selected Agent returns course content.</li>
              <li>PostgreSQL owns versions and creator approval.</li>
              <li>Failures are application-specific operational facts.</li>
            </ul>
          </article>
          <article class="future">
            <p class="step">With Kungfu · next adapter</p>
            <h3>The work becomes independently governable.</h3>
            <ul>
              <li>A bounded Assignment says who owns the work.</li>
              <li>Evidence binds inspectable output to the claim.</li>
              <li>An independent review drives request-work or close.</li>
              <li>Typed decisions, recovery receipts, and a seal prove the result.</li>
            </ul>
          </article>
        </div>
        <div class="hub-demo-callout ${demo.ready ? 'ready' : ''}">
          <div>
            <strong>See the difference in a real Kungfu runtime</strong>
            <p>${escapeHtml(hubStatus)} It demonstrates real Assignment, evidence, review, decision, and seal state, but it does not own this user account or course.</p>
          </div>
          ${demoLink}
        </div>
      </div>
    </details>`;
}

function friendlyFailureMessage(failure) {
  const detail = String(failure?.detail ?? '');
  if (/invalid JSON|Unterminated string|incomplete structured output/iu.test(detail)) {
    return 'The local model returned an incomplete structured result. Your brief is safe—retry, or switch this course to Mock.';
  }
  return 'The last Agent action did not complete. Your brief and every saved version are safe; you can retry or switch models.';
}

function renderOperationFailure(course) {
  const failure = course.lastOperationFailure;
  if (!failure) return '';
  return `
    <section class="operation-failure" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <p class="step">Last Agent action · needs retry</p>
        <h2>The course is safe and ready to continue.</h2>
        <p>${escapeHtml(friendlyFailureMessage(failure))}</p>
        <details>
          <summary>Technical detail</summary>
          <p>${escapeHtml(failure.detail ?? 'No provider detail was returned.')}</p>
        </details>
      </div>
    </section>`;
}

async function showCourse(id, message = '', selectedVersionId = null) {
  const { course } = await request(`/api/courses/${id}`);
  const selected = course.versions.find((version) => version.id === selectedVersionId)
    ?? course.versions[0]
    ?? null;
  const isCurrent = selected?.id === course.currentOutlineVersionId;
  const agentLabel = courseAgentLabel(course, selected);
  const actionAgentLabel = currentCourseAgentLabel(course);
  const courseRuntime = backendPresentation(
    course.backendKind
      ?? selected?.agentRun?.backend
      ?? (course.agentWork?.simulated === false ? 'openai-compatible' : 'mock'),
  );
  const versionRuntime = selected
    ? backendPresentation(selected.agentRun?.backend)
    : courseRuntime;
  const selectedRuntime = backendPresentation(selectedBackend);
  const runtimeDiffers = selectedBackend !== courseRuntime.kind;
  const simulated = versionRuntime.simulated;
  const bindingReady = Boolean(course.agentWork)
    && course.backendStatus !== 'provisioning'
    && course.backendStatus !== 'failed';
  app.innerHTML = `
    <button id="back" class="back">← My courses</button>
    <section class="course-head">
      <div>
        <p class="eyebrow">Course project</p>
        <h1>${escapeHtml(course.title)}</h1>
        <p class="lede">${escapeHtml(course.brief.promisedOutcome)}</p>
      </div>
      <div class="course-metric">
        <strong>${course.versions.length}</strong>
        <span>saved ${course.versions.length === 1 ? 'version' : 'versions'}</span>
      </div>
    </section>
    <p id="course-message" class="success">${escapeHtml(message)}</p>
    <section
      class="course-runtime-notice ${selectedRuntime.tone}"
      data-course-runtime-notice
      data-course-backend="${courseRuntime.kind}"
      ${runtimeDiffers ? '' : 'hidden'}
    >
      <strong>${escapeHtml(selectedRuntime.short)} is selected for new courses.</strong>
      <span>This course currently uses ${escapeHtml(courseRuntime.short)}. Switch it below; saved versions keep their original source.</span>
    </section>
    ${renderCourseBinding(course, courseRuntime)}
    ${renderWorkControlPanel(course, selected, isCurrent)}
    ${renderOperationFailure(course)}
    <section class="course-workspace">
      <aside>
        <div class="brief-card">
          <p class="step">Your saved brief</p>
          <dl>
            <dt>Target learner</dt><dd>${escapeHtml(course.brief.targetLearner)}</dd>
            <dt>Learner problem</dt><dd>${escapeHtml(course.brief.learnerProblem)}</dd>
            <dt>Your advantage</dt><dd>${escapeHtml(course.brief.creatorExpertise)}</dd>
            <dt>Constraints</dt><dd>${escapeHtml(course.brief.deliveryConstraints)}</dd>
          </dl>
        </div>
        <div class="agent-card ${courseRuntime.tone}">
          <p class="step">Delegated work</p>
          <span class="course-backend ${courseRuntime.tone}">${escapeHtml(courseRuntime.badge)}</span>
          <h2>${selected ? 'Ask the Agent for another pass' : 'Ask the Agent for a first draft'}</h2>
          <p>${selected
            ? 'A revision becomes a new immutable version. The version you are viewing stays intact.'
            : `${escapeHtml(actionAgentLabel)} will turn your saved brief into a visible three-module outline.`}</p>
          ${selected ? `
            <form id="revise-form">
              <p class="field-shortcut">Press <kbd>Tab</kbd> in the empty field to use the suggested feedback.</p>
              <label>What should improve?
                <textarea name="feedback" rows="4" maxlength="1000" placeholder="Make the exercises more concrete and strengthen the validation step." required></textarea>
              </label>
              <button type="submit" class="primary-action" ${bindingReady ? '' : 'disabled'}>Improve as a new version</button>
            </form>
            <button id="generate-again" class="secondary-action" ${bindingReady ? '' : 'disabled'}>Generate a different draft</button>
          ` : `<button id="generate" class="primary-action" ${bindingReady ? '' : 'disabled'}>Generate my first course outline</button>`}
          ${bindingReady ? '' : '<p class="binding-wait">Waiting for the current course model binding to become ready.</p>'}
          <div id="handoff-live" class="handoff-live" aria-live="polite" hidden></div>
        </div>
        ${course.versions.length ? `
          <div class="version-history">
            <p class="step">Version history</p>
            ${course.versions.map((version) => versionButton(version, selected?.id)).join('')}
          </div>` : ''}
      </aside>
      <article class="draft-panel">
        ${selected ? `
          ${renderAIOutputHero(selected, versionRuntime)}
          <div class="draft-toolbar">
            <div>
              <span class="status">${isCurrent ? 'current approved version' : selected.status}</span>
              <strong class="generated-by">${versionRuntime.simulated ? 'Simulated by' : 'Generated by local AI'} · ${escapeHtml(agentLabel)}</strong>
              <p>Version ${selected.versionNumber} · ${escapeHtml(agentVersionLabel(selected))}</p>
            </div>
            ${isCurrent
              ? '<span class="approved-mark">Approved ✓</span>'
              : `<button id="approve" class="approve-action">Approve version ${selected.versionNumber}</button>`}
          </div>
          ${renderHandoff(selected, isCurrent)}
          ${renderSavedBriefSource(course)}
          ${renderOutputBoundary(selected, versionRuntime)}
          <section class="ai-generated-content ${versionRuntime.tone}" aria-label="${versionRuntime.simulated ? 'Mock reference content' : 'Local AI generated content'}">
            <p class="ai-content-label">${versionRuntime.simulated ? 'System template output · no AI inference' : 'Local model output · generated inside this deployment'}</p>
            ${renderAgentChanges(selected, versionRuntime)}
            ${renderOutline(selected.outline, versionRuntime)}
          </section>
        ` : `
          <div class="empty-draft ${courseRuntime.tone}">
            <span class="empty-runtime-mark">${courseRuntime.simulated ? 'MOCK' : 'LOCAL AI'}</span>
            <p class="eyebrow">${escapeHtml(courseRuntime.name)} · ready</p>
            <h2>${courseRuntime.simulated
              ? 'Generate a deterministic reference outline in the right pane.'
              : 'Ask local Qwen to generate the first course outline in this right pane.'}</h2>
            <p>${courseRuntime.simulated
              ? 'The result will be visibly marked as Mock and saved as a version in PostgreSQL.'
              : 'The generated modules, lessons, exercises, and questions will appear here with local-model provenance.'}</p>
          </div>`}
      </article>
    </section>
    <details class="technical-details">
      <summary>How this result was produced</summary>
      <p>${simulated
        ? 'The selected version was created by the deterministic Mock Agent. It proves the replaceable port, version ownership, and audit boundary; it does not claim real AI or Kungfu execution.'
        : `${escapeHtml(agentLabel)} created the selected version through an OpenAI-compatible endpoint. PostgreSQL still owns the saved versions and your approval decision.`}</p>
      <dl class="technical">
        <dt>Contract</dt><dd>${escapeHtml(course.agentWork?.contract ?? 'provisioning')}</dd>
        <dt>Current course backend</dt><dd>${escapeHtml(course.backendKind)}</dd>
        <dt>Current course binding</dt><dd>${escapeHtml(course.agentWork?.bindingId ?? 'provisioning')}</dd>
        <dt>Selected version backend</dt><dd>${escapeHtml(selected?.agentRun?.backend ?? 'no version yet')}</dd>
        <dt>Selected version binding</dt><dd>${escapeHtml(selected?.agentRun?.backendBindingId ?? 'no version yet')}</dd>
        <dt>Selected version transition</dt><dd>${escapeHtml(selected?.agentRun?.transitionId ?? 'no version yet')}</dd>
      </dl>
    </details>`;
  document.querySelector('#back').addEventListener('click', () => showCourses());
  for (const button of document.querySelectorAll('[data-version-id]')) {
    button.addEventListener('click', () => showCourse(id, '', button.dataset.versionId));
  }
  for (const button of document.querySelectorAll('[data-bind-course-backend]')) {
    button.addEventListener('click', async () => {
      const target = backendPresentation(button.dataset.bindCourseBackend);
      button.disabled = true;
      try {
        const result = await runVisibleWorkflow({
          eyebrow: 'Visible workflow · Course model binding',
          title: `Switching this course to ${target.short}`,
          steps: [
            'Checking that the selected runtime is ready',
            'Preserving every existing version and its model source',
            `Provisioning this course’s ${target.short} Agent binding`,
            'Setting future Generate and Improve actions to the new binding',
          ],
          success: `${target.name} is now bound to this course`,
          task: () => request(`/api/courses/${id}/backend`, {
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey('switch-backend') },
            body: { backendKind: target.kind },
          }),
        });
        await showCourse(
          id,
          `${target.name} is now the current model for future Agent work. Existing versions are unchanged.`,
          selected?.id ?? result.course.versions[0]?.id ?? null,
        );
      } catch (error) {
        await showCourse(id, error.message, selected?.id ?? null);
      }
    });
  }
  document.querySelector('#generate')?.addEventListener('click', () =>
    runAgentAction(id, 'generate', {}, false, actionAgentLabel, course.versions[0]?.id ?? null));
  document.querySelector('#generate-again')?.addEventListener('click', () =>
    runAgentAction(id, 'generate', {}, true, actionAgentLabel, course.versions[0]?.id ?? null));
  const reviseForm = document.querySelector('#revise-form');
  if (reviseForm) wireTabPlaceholderAcceptance(reviseForm);
  reviseForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runAgentAction(
      id,
      'revise',
      Object.fromEntries(new FormData(event.currentTarget)),
      true,
      actionAgentLabel,
      course.versions[0]?.id ?? null,
    );
  });
  document.querySelector('#approve')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const result = await runVisibleWorkflow({
        eyebrow: 'Visible workflow · Business decision',
        title: `Approving version ${selected.versionNumber}`,
        steps: [
          'Checking that this version belongs to your account',
          'Recording your approval decision',
          'Updating the course’s current-version pointer',
        ],
        success: `Version ${selected.versionNumber} is approved`,
        task: () => request(`/api/courses/${id}/versions/${selected.id}/approve`, {
          method: 'POST',
          body: {},
        }),
      });
      await showCourse(id, `Version ${selected.versionNumber} is now the approved business result.`, result.course.currentOutlineVersionId);
    } catch (error) {
      await showCourse(id, error.message, selected.id);
    }
  });
}

async function runAgentAction(
  id,
  action,
  body,
  hasExistingVersion = true,
  requestedAgentLabel = activeAgentLabel(),
  previousNewestId = null,
) {
  const controls = app.querySelectorAll('button, textarea');
  controls.forEach((control) => { control.disabled = true; });
  try {
    const revising = action === 'revise';
    const agentLabel = requestedAgentLabel;
    const { course } = await runVisibleWorkflow({
      title: revising
        ? 'Improving your course outline'
        : hasExistingVersion
          ? 'Generating another course outline'
          : 'Generating your first course outline',
      steps: revising
        ? [
          'Reading your saved course brief',
          'Comparing your feedback with the latest version',
          `${agentLabel} is reshaping the learning path`,
          'Preparing a new immutable outline version',
        ]
        : [
          'Reading your saved course brief',
          hasExistingVersion
            ? 'Finding a different teaching route'
            : 'Finding a clear teaching route',
          `${agentLabel} is structuring the modules`,
          'Preparing a new immutable outline version',
        ],
      success: 'New outline version saved to your course collection',
      task: async () => {
        const result = await request(`/api/courses/${id}/actions/${action}`, {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey(action) },
          body,
        });
        const newest = result.course?.versions?.[0];
        if (!newest || newest.id === previousNewestId) {
          throw new Error(`${agentLabel} did not return a new outline. Please try again.`);
        }
        return result;
      },
    });
    const newest = course?.versions?.[0];
    await showCourse(
      id,
      action === 'generate'
        ? `${courseAgentLabel(course, newest)} created version ${newest.versionNumber}.`
        : `Your feedback produced version ${newest.versionNumber}; the previous version is unchanged.`,
      newest.id,
    );
  } catch (error) {
    await showCourse(id, error.message);
  }
}

try {
  session = await request('/api/session');
  await refreshRuntime();
  if (session.authenticated) await showCourses();
  else showAuth();
} catch (error) {
  showAuth(error.message);
}

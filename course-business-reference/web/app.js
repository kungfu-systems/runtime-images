import { randomUuid } from './random-uuid.js';

const app = document.querySelector('#app');
const account = document.querySelector('#account');
const backendBanner = document.querySelector('#backend-banner');
let session = null;
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

function activeAgentLabel() {
  return backendState.label || (backendState.simulated ? 'Visible Mock Agent' : 'Course Designer');
}

function courseAgentLabel(course, selected = null) {
  return selected?.outline?.agentContribution?.role
    || (course.agentWork?.simulated ? 'Mock Course Designer' : activeAgentLabel());
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
        updateBackend(session.agentBackend);
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
  return `
    <button class="course-card" data-course-id="${course.id}">
      <span class="status">${course.current_outline_version_id ? 'approved course' : 'course in progress'}</span>
      <h2>${escapeHtml(course.title)}</h2>
      <p>For ${escapeHtml(course.target_learner)}</p>
      <div class="card-footer"><span>${escapeHtml(versionLabel)}</span><strong>Open course →</strong></div>
    </button>`;
}

async function showCourses(message = '') {
  wireAccount();
  const { courses } = await request('/api/courses');
  app.innerHTML = `
    <section class="dashboard-head">
      <div>
        <p class="eyebrow">Your course collection</p>
        <h1>Every course has its own evolving outline.</h1>
      </div>
      <button id="new-course" class="primary-action">Create a new course</button>
    </section>
    <p class="dashboard-copy">Generating again does not create another course or overwrite your work. It appends a new version inside the same course.</p>
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
  app.innerHTML = `
    <button id="back" class="back">← My courses</button>
    <section class="editor-head">
      <p class="eyebrow">Create a course project</p>
      <h1>Give the Agent a useful brief.</h1>
      <p class="lede">These are durable business facts. The Agent will use them to generate a draft, but your application owns the brief and every approved version.</p>
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
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      await showCourse(course.id, 'Course created. Your brief is saved.');
    } catch (error) {
      showNewCourse(error.message);
    }
  });
}

function renderOutline(outline) {
  return `
    <div class="outline">
      <div class="outline-intro">
        <p class="eyebrow">Course promise</p>
        <h2>${escapeHtml(outline.title)}</h2>
        <p><strong>For:</strong> ${escapeHtml(outline.audience)}</p>
        <p><strong>Outcome:</strong> ${escapeHtml(outline.promise)}</p>
        <p><strong>Format:</strong> ${escapeHtml(outline.delivery)}</p>
      </div>
      <div class="module-list">
        ${(outline.modules ?? []).map((module) => `
          <article class="module">
            <span>${escapeHtml(module.number)}</span>
            <div>
              <h3>${escapeHtml(module.title)}</h3>
              <p>${escapeHtml(module.outcome)}</p>
              <ul>${(module.lessons ?? []).map((lesson) => `<li>${escapeHtml(lesson)}</li>`).join('')}</ul>
              <div class="exercise"><strong>Observable exercise</strong><p>${escapeHtml(module.exercise)}</p></div>
            </div>
          </article>`).join('')}
      </div>
      <div class="questions">
        <h3>Questions to resolve before publishing</h3>
        <ol>${(outline.openQuestions ?? []).map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>
      </div>
    </div>`;
}

function agentVersionLabel(version) {
  if (version.agentRun?.action === 'revise_outline') return 'Agent revision';
  if (version.agentRun?.previousVersionId) return 'Agent alternative';
  return 'Agent first draft';
}

function renderHandoff(version, isCurrent) {
  const contribution = version.outline.agentContribution ?? {};
  const hasStructuredContribution = Boolean(contribution.changes?.length);
  const changes = hasStructuredContribution
    ? contribution.changes
    : [
      version.changeSummary,
      'This earlier version predates structured per-change reporting.',
    ];
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
      <div class="agent-changes">
        <p class="step">What the Agent changed</p>
        <ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('')}</ul>
      </div>
    </section>`;
}

function versionButton(version, selectedId) {
  const active = version.id === selectedId ? ' active' : '';
  return `
    <button class="version-button${active}" data-version-id="${version.id}">
      <span><strong>v${version.versionNumber}</strong><small>${escapeHtml(agentVersionLabel(version))}</small></span>
      <em>${escapeHtml(version.status)}</em>
    </button>`;
}

async function showCourse(id, message = '', selectedVersionId = null) {
  const { course } = await request(`/api/courses/${id}`);
  const selected = course.versions.find((version) => version.id === selectedVersionId)
    ?? course.versions[0]
    ?? null;
  const isCurrent = selected?.id === course.currentOutlineVersionId;
  const agentLabel = courseAgentLabel(course, selected);
  const simulated = course.agentWork?.simulated ?? backendState.simulated;
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
        <div class="agent-card">
          <p class="step">Delegated work</p>
          <h2>${selected ? 'Ask the Agent for another pass' : 'Ask the Agent for a first draft'}</h2>
          <p>${selected
            ? 'A revision becomes a new immutable version. The version you are viewing stays intact.'
            : `${escapeHtml(agentLabel)} will turn your saved brief into a visible three-module outline.`}</p>
          ${selected ? `
            <form id="revise-form">
              <p class="field-shortcut">Press <kbd>Tab</kbd> in the empty field to use the suggested feedback.</p>
              <label>What should improve?
                <textarea name="feedback" rows="4" maxlength="1000" placeholder="Make the exercises more concrete and strengthen the validation step." required></textarea>
              </label>
              <button type="submit" class="primary-action">Improve as a new version</button>
            </form>
            <button id="generate-again" class="secondary-action">Generate a different draft</button>
          ` : '<button id="generate" class="primary-action">Generate my first course outline</button>'}
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
          <div class="draft-toolbar">
            <div>
              <span class="status">${isCurrent ? 'current approved version' : selected.status}</span>
              <strong class="generated-by">Generated by ${escapeHtml(agentLabel)}</strong>
              <p>Version ${selected.versionNumber} · ${escapeHtml(agentVersionLabel(selected))}</p>
            </div>
            ${isCurrent
              ? '<span class="approved-mark">Approved ✓</span>'
              : `<button id="approve" class="approve-action">Approve version ${selected.versionNumber}</button>`}
          </div>
          ${renderHandoff(selected, isCurrent)}
          ${renderOutline(selected.outline)}
        ` : `
          <div class="empty-draft">
            <p class="eyebrow">No outline yet</p>
            <h2>Your brief belongs to the business app. The next step delegates one bounded job to the Agent.</h2>
            <p>The Agent will return a draft; it cannot approve the result for you.</p>
          </div>`}
      </article>
    </section>
    <details class="technical-details">
      <summary>How this result was produced</summary>
      <p>${simulated
        ? 'This course uses a deterministic Mock Agent. It proves the replaceable port, version ownership, and audit boundary; it does not claim real AI or Kungfu execution.'
        : `${escapeHtml(agentLabel)} generated the draft through an OpenAI-compatible endpoint. PostgreSQL still owns the saved versions and your approval decision.`}</p>
      <dl class="technical">
        <dt>Contract</dt><dd>${escapeHtml(course.agentWork?.contract ?? 'provisioning')}</dd>
        <dt>Backend</dt><dd>${escapeHtml(course.agentWork?.backend ?? backendState.kind)}</dd>
        <dt>Binding</dt><dd>${escapeHtml(course.agentWork?.bindingId ?? 'provisioning')}</dd>
        <dt>Transition</dt><dd>${escapeHtml(course.agentWork?.transitionId ?? 'provisioning')}</dd>
      </dl>
    </details>`;
  document.querySelector('#back').addEventListener('click', () => showCourses());
  for (const button of document.querySelectorAll('[data-version-id]')) {
    button.addEventListener('click', () => showCourse(id, '', button.dataset.versionId));
  }
  document.querySelector('#generate')?.addEventListener('click', () =>
    runAgentAction(id, 'generate', {}, false, agentLabel, course.versions[0]?.id ?? null));
  document.querySelector('#generate-again')?.addEventListener('click', () =>
    runAgentAction(id, 'generate', {}, true, agentLabel, course.versions[0]?.id ?? null));
  const reviseForm = document.querySelector('#revise-form');
  if (reviseForm) wireTabPlaceholderAcceptance(reviseForm);
  reviseForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runAgentAction(
      id,
      'revise',
      Object.fromEntries(new FormData(event.currentTarget)),
      true,
      agentLabel,
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
      task: () => request(`/api/courses/${id}/actions/${action}`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey(action) },
        body,
      }),
    });
    const newest = course?.versions?.[0];
    if (!newest || newest.id === previousNewestId) {
      throw new Error(`${agentLabel} did not return a new outline. Please try again.`);
    }
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
  updateBackend(session.agentBackend);
  if (session.authenticated) await showCourses();
  else showAuth();
} catch (error) {
  showAuth(error.message);
}

import './styles.css';
import {
  STEP_IDS,
  auth,
  clientApi,
  fmtBytes,
  fmtDate,
  type Client,
  type Customer,
  type CustomerStatus,
  type DocumentSpec,
  type StepId,
  type StepRun,
} from './api';

type Tab = 'customers' | 'steps' | 'config' | 'documents';

type State = {
  clients: Client[];
  selectedSlug: string | null;
  tab: Tab;
  busy: boolean;
};

const state: State = {
  clients: [],
  selectedSlug: null,
  tab: 'customers',
  busy: false,
};

// ---------- tiny DOM helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = String(value ?? '');
    else if (key === 'html') node.innerHTML = String(value ?? '');
    else if (key === 'onclick') node.addEventListener('click', value as EventListener);
    else if (key === 'onchange') node.addEventListener('change', value as EventListener);
    else if (key === 'onsubmit') node.addEventListener('submit', value as EventListener);
    else if (key === 'oninput') node.addEventListener('input', value as EventListener);
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node: HTMLElement): void {
  node.replaceChildren();
}

const app = document.getElementById('app')!;

// ---------- toast ----------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, error = false): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = el('div', { class: `toast${error ? ' err' : ''}`, text: message });
  app.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 5000);
}

function fail(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  toast(msg, true);
}

// ---------- status helpers ----------
const STATUS_LABEL: Record<CustomerStatus, string> = {
  registered: 'registered',
  welcome_sent: 'welcome sent',
  docs_sent: 'docs sent',
  checkin_sent: 'check-in sent',
  week1_sent: 'week-1 sent',
  failed: 'failed',
};

function statusBadge(status: CustomerStatus, failed: boolean): HTMLElement {
  if (failed || status === 'failed') return el('span', { class: 'badge err', text: 'failed' });
  return el('span', { class: `badge ${status === 'registered' ? '' : 'ok'}`, text: STATUS_LABEL[status] });
}

// ---------- shell ----------
function renderShell(): void {
  clear(app);

  const topLeft = el('div', { class: 'brand' }, [
    el('span', { text: 'HAUTO' }),
    el('span', { class: 'accent', text: 'MAI' }),
    el('small', { text: 'onboarding control' }),
  ]);

  const runCron = el('button', { text: '⏱ run scheduler tick' });
  runCron.addEventListener('click', async () => {
    try {
      const r = await clientApi.runTick();
      toast(`tick done · ${r.fired} step(s) fired`);
      if (state.selectedSlug) await refreshData();
    } catch (err) {
      fail(err);
    }
  });

  const tokenForm = el('form', { class: 'row-between' }, [
    el('input', { type: 'password', placeholder: 'admin token', value: auth.token }),
    el('button', { type: 'submit', class: 'small', text: 'set' }),
  ]);
  tokenForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = tokenForm.querySelector('input') as HTMLInputElement;
    auth.token = input.value;
    toast('token saved');
    refreshData();
  });

  const topbar = el('header', { class: 'topbar' }, [
    topLeft,
    el('div', { class: 'spacer' }),
    runCron,
    tokenForm,
  ]);

  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' });
  const main = el('main', { class: 'main', id: 'main' });

  app.append(topbar, el('div', { class: 'layout' }, [sidebar, main]));
}

// ---------- sidebar ----------
function renderSidebar(container: HTMLElement): void {
  clear(container);

  const nameInput = el('input', { placeholder: 'New client name', autocomplete: 'off' });
  const slugInput = el('input', { placeholder: 'slug (auto)', autocomplete: 'off', style: 'margin-top:6px' });
  const createBtn = el('button', { class: 'primary', type: 'submit', text: 'create client' });
  const form = el('form', { class: 'create' }, [el('label', { text: 'Add a client' }), nameInput, slugInput, el('div', { style: 'margin-top:8px' }, [createBtn])]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      await clientApi.create(name, slugInput.value.trim() || undefined);
      nameInput.value = '';
      slugInput.value = '';
      await refreshData();
      toast('client created');
    } catch (err) {
      fail(err);
    } finally {
      createBtn.disabled = false;
    }
  });

  const list = el('div');
  const buttons = state.clients.map((c) => {
    const btn = el(
      'button',
      {
        class: `client-btn${state.selectedSlug === c.slug ? ' selected' : ''}`,
        type: 'button',
      },
      [c.config.name || c.slug, el('span', { class: 'slug', text: `/${c.slug}` })],
    );
    btn.addEventListener('click', () => {
      state.selectedSlug = c.slug;
      window.location.hash = `#/clients/${c.slug}`;
    });
    return btn;
  });
  list.append(...buttons);

  container.append(
    form,
    el('h3', { text: 'Clients' }),
    buttons.length ? list : el('p', { class: 'hint', text: 'no clients yet — create one to begin' }),
  );
}

// ---------- main ----------
function renderMain(container: HTMLElement): void {
  clear(container);
  const client = state.clients.find((c) => c.slug === state.selectedSlug);
  if (!client) {
    container.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Select a client' }),
        el('p', { class: 'hint', text: 'Choose a client in the sidebar to configure its onboarding flow.' }),
      ]),
    );
    return;
  }

  const headline = el('div', { class: 'headline' }, [
    el('h1', { text: client.config.name || client.slug }),
    el('span', { class: 'slug', text: `/${client.slug}` }),
  ]);

  const tabs = el('div', { class: 'tabs' });
  const tabDefs: Array<[Tab, string]> = [
    ['customers', 'Customers'],
    ['steps', 'Steps'],
    ['config', 'Config'],
    ['documents', 'Documents'],
  ];
  for (const [id, labelTxt] of tabDefs) {
    const btn = el('button', { class: state.tab === id ? 'active' : '', type: 'button', text: labelTxt });
    btn.addEventListener('click', () => {
      state.tab = id;
      renderMain(container);
    });
    tabs.appendChild(btn);
  }

  const body = el('div', { id: 'tab-body' });
  container.append(headline, tabs, body);
  renderTab(body, client);
}

function renderTab(body: HTMLElement, client: Client): void {
  clear(body);
  if (state.tab === 'customers') renderCustomers(body, client);
  else if (state.tab === 'steps') renderSteps(body, client);
  else if (state.tab === 'config') renderConfig(body, client);
  else renderDocuments(body, client);
}

// ---------- customers tab ----------
function renderCustomers(body: HTMLElement, client: Client): void {
  const [nameInput, emailInput] = [
    el('input', { placeholder: 'Full name', autocomplete: 'off' }),
    el('input', { placeholder: 'Email', autocomplete: 'off' }),
  ];
  const packageInput = el('input', { placeholder: 'Package (optional)', autocomplete: 'off' });
  const simBtn = el('button', { class: 'primary', type: 'submit', text: 'simulate signup' });

  const simForm = el('form', { class: 'grid' }, [
    el('div', { class: 'form-field' }, [el('label', { text: 'Full name' }), nameInput]),
    el('div', { class: 'form-field' }, [el('label', { text: 'Email' }), emailInput]),
    el('div', { class: 'form-field' }, [el('label', { text: 'Package' }), packageInput]),
    el('div', { class: 'form-field', style: 'align-self:end' }, [simBtn]),
  ]);

  const searchInput = el('input', { placeholder: 'search customers…', style: 'max-width:320px' });

  const runSteps = el('button', { type: 'button', class: 'small', text: 'refresh' });
  let customers: Customer[] = [];

  const tableBox = el('div');

  async function loadCustomers(): Promise<void> {
    customers = await clientApi.customers(client.slug, searchInput.value.trim() || undefined);
    renderTable();
  }

  function renderTable(): void {
    clear(tableBox);
    if (customers.length === 0) {
      tableBox.append(el('p', { class: 'hint', text: 'no customers yet — run a simulated signup above' }));
      return;
    }
    const table = el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Customer' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'Signup' }),
          el('th', { text: 'Actions' }),
        ]),
      ]),
      el('tbody', {}, customers.map((c) => tableRow(c))),
    ]);
    tableBox.append(table);
  }

  function tableRow(c: Customer): HTMLElement {
    const actions = el('div', { class: 'actions' });

    const badge = statusBadge(c.status, c.failed);

    const detailsBtn = el('button', { class: 'small', type: 'button', text: 'steps' });
    detailsBtn.addEventListener('click', () => showCustomerSteps(client, c));

    const notifyBtn = el('button', { class: 'small', type: 'button', text: 'retry' });
    notifyBtn.addEventListener('click', async () => {
      notifyBtn.disabled = true;
      try {
        await clientApi.retry(client.slug, c.id);
        toast('retry queued');
        await loadCustomers();
      } catch (err) {
        fail(err);
      } finally {
        notifyBtn.disabled = false;
      }
    });

    actions.append(detailsBtn);
    if (c.failed) actions.appendChild(notifyBtn);

    return el('tr', {}, [
      el('td', {}, [
        el('strong', { text: c.payload.customerName }),
        el('div', { class: 'hint', text: c.payload.email }),
      ]),
      el('td', {}, [badge]),
      el('td', { class: 'hint', text: fmtDate(c.signupAt) }),
      el('td', {}, [actions]),
    ]);
  }

  async function refresh(): Promise<void> {
    try {
      await loadCustomers();
    } catch (err) {
      fail(err);
    }
  }

  simForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const customer: Record<string, string> = { customerName: nameInput.value.trim(), email: emailInput.value.trim() };
    if (packageInput.value.trim()) customer.package = packageInput.value.trim();
    if (!customer.customerName || !customer.email) {
      toast('name and email are required', true);
      return;
    }
    simBtn.disabled = true;
    try {
      const r = await clientApi.simulate(client.slug, customer);
      const summary = r.results
        .map((x) => `${x.step.replace('send_', '').replace('create_crm_contact', 'crm')}:${x.status}`)
        .join(', ');
      toast(`simulated ${customer.email} → ${summary}`);
      await loadCustomers();
    } catch (err) {
      fail(err);
    } finally {
      simBtn.disabled = false;
    }
  });

  searchInput.addEventListener('input', () => {
    void loadCustomers();
  });
  runSteps.addEventListener('click', () => {
    void refresh();
  });

  body.append(
    el('div', { class: 'panel' }, [
      el('h3', { text: 'Simulate a signup' }),
      simForm,
      el('div', { class: 'alert', html: `Public webhook: <span class="hook">POST /webhook/${client.slug}</span>` }),
    ]),
    el('div', { class: 'row-between', style: 'margin-bottom:10px' }, [searchInput, runSteps]),
    tableBox,
  );

  void refresh();
}

async function showCustomerSteps(client: Client, customer: Customer): Promise<void> {
  try {
    const data = await clientApi.customerSteps(client.slug, customer.email);
    const rows = data.runs
      .slice()
      .sort((a, b) => a.step.localeCompare(b.step) || b.createdAt.localeCompare(a.createdAt));
    const listRows = rows.length
      ? rows.map((r) => stepRunBanner(r))
      : [el('p', { class: 'hint', text: 'no step runs yet' })];

    const done = Object.entries(customer.completedSteps).map(([step, when]) =>
      el('div', { class: 'step-row' }, [
        el('div', { class: 'step-name', text: step }),
        el('div', { class: 'step-meta', text: `completed ${fmtDate(when)}` }),
      ]),
    );

    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:40';
    const card = el(
      'div',
      { class: 'panel', style: 'max-width:640px;width:92%;max-height:80vh;overflow:auto' },
      [
        el('div', { class: 'row-between' }, [
          el('h3', { text: customer.payload.customerName }),
          el('button', { class: 'small', type: 'button', text: 'close' }),
        ]),
        el('div', { class: 'alert', text: customer.payload.email }),
        el('h3', { text: 'Completed steps' }),
        done.length ? el('div', {}, done) : el('p', { class: 'hint', text: 'none yet' }),
        el('h3', { text: 'Step runs' }),
        el('div', {}, listRows),
      ],
    );
    card.querySelector('button')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  } catch (err) {
    fail(err);
  }
}

function stepRunBanner(r: StepRun): HTMLElement {
  const cls = r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : r.status === 'pending' ? 'warn' : '';
  const meta = `status:${r.status} · attempts:${r.attempts} · ${fmtDate(r.runAt ?? r.nextAttemptAt ?? r.createdAt)}`;
  return el('div', { class: 'step-row' }, [
    el('span', { class: `badge ${cls}`, text: r.step }),
    el('div', {}, [
      el('div', { class: 'step-meta', text: meta }),
      r.lastError ? el('div', { class: 'step-meta', text: r.lastError }) : null,
    ]),
  ]);
}

// ---------- steps tab ----------
const DEFAULT_DELAY: Partial<Record<StepId, number>> = {
  create_crm_contact: 0,
  send_team_alert: 0,
  send_welcome_email: 5,
  send_documents: 120,
  send_checkin: 1440,
  send_week1: 4320,
};

function renderSteps(body: HTMLElement, client: Client): void {
  const fields = STEP_IDS.map((step) => {
    const cfg = client.config.steps?.[step] ?? { enabled: true, trigger: 'inbound' as const };
    const enabledInput = el('input', { type: 'checkbox', checked: cfg.enabled !== false });
    const triggerSelect = el('select', {}, [
      el('option', { value: 'inbound', selected: cfg.trigger !== 'scheduler', text: 'inbound' }),
      el('option', { value: 'scheduler', selected: cfg.trigger === 'scheduler', text: 'scheduler' }),
    ]);
    const delayInput = el('input', {
      type: 'number',
      min: 0,
      value: String(cfg.scheduler?.delayMinutes ?? DEFAULT_DELAY[step] ?? 0),
    });
    const businessInput = el('input', { type: 'checkbox', checked: cfg.scheduler?.businessHoursOnly === true });
    return { step, cfg, enabledInput, triggerSelect, delayInput, businessInput };
  });

  const signupChecks = STEP_IDS.map((step) => {
    const input = el('input', { type: 'checkbox', checked: client.config.trigger.signupSteps.includes(step) });
    return { step, input };
  });

  const retryMax = el('input', { type: 'number', min: 1, value: String(client.config.retry.maxAttempts) });
  const retryDelay = el('input', { type: 'number', min: 0, value: String(client.config.retry.baseDelayMs) });
  const timezone = el('input', { value: client.config.timezone || 'UTC' });

  const saveBtn = el('button', { class: 'primary', type: 'submit', text: 'save step config' });

  const form = el('form', {}, [
    el('div', { class: 'panel' }, [
      el('h3', { text: 'Steps' }),
      ...fields.map((f) =>
        el('div', { class: 'step-row' }, [
          el('div', { class: 'step-name', text: f.step }),
          el('div', { class: 'row-between', style: 'justify-content:flex-start' }, [
            el('label', { text: 'trigger' }),
            f.triggerSelect,
            el('label', { text: 'delay (min)' }),
            el('span', {}, [f.delayInput]),
            el('label', { text: 'enabled' }),
            el('span', {}, [f.enabledInput]),
            el('label', { text: 'business-hours only' }),
            el('span', {}, [f.businessInput]),
          ]),
        ]),
      ),
    ]),
    el('div', { class: 'panel' }, [
      el('h3', { text: 'Signup steps (fired on inbound webhook / stripe)' }),
      el('div', { class: 'grid' }, signupChecks.map((s) =>
        el('label', { class: 'form-field' }, [s.input, el('span', { text: ` ${s.step}` })]),
      )),
    ]),
    el('div', { class: 'panel grid' }, [
      el('div', { class: 'form-field' }, [el('label', { text: 'max attempts / step' }), retryMax]),
      el('div', { class: 'form-field' }, [el('label', { text: 'retry base delay (ms)' }), retryDelay]),
      el('div', { class: 'form-field' }, [el('label', { text: 'timezone' }), timezone]),
    ]),
    el('div', { style: 'margin-top:6px' }, [saveBtn]),
  ]);

  body.append(form);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nextSteps: Record<string, unknown> = {};
    for (const f of fields) {
      const schedulerEnabled = f.triggerSelect.value === 'scheduler';
      nextSteps[f.step] = {
        enabled: f.enabledInput.checked,
        trigger: f.triggerSelect.value,
        scheduler: schedulerEnabled
          ? {
              enabled: true,
              delayMinutes: Number(f.delayInput.value) || 0,
              businessHoursOnly: f.businessInput.checked,
            }
          : undefined,
      };
    }
    const signupSteps = signupChecks.filter((s) => s.input.checked).map((s) => s.step);
    const config = {
      ...client.config,
      trigger: { ...client.config.trigger, signupSteps },
      steps: nextSteps,
      retry: { maxAttempts: Number(retryMax.value) || 3, baseDelayMs: Number(retryDelay.value) || 1000 },
      timezone: timezone.value || 'UTC',
    };
    try {
      await clientApi.saveConfig(client.slug, config);
      toast('step config saved');
      await refreshData();
    } catch (err) {
      fail(err);
    }
  });
}

// ---------- config tab ----------
function renderConfig(body: HTMLElement, client: Client): void {
  const ta = el('textarea', { class: 'code', spellcheck: 'false' });
  ta.value = JSON.stringify(client.config, null, 2);
  const saveBtn = el('button', { class: 'primary', type: 'submit', text: 'save config' });
  const restoreBtn = el('button', { type: 'button', text: 'revert' });
  restoreBtn.addEventListener('click', () => {
    ta.value = JSON.stringify(client.config, null, 2);
  });

  const form = el('form', {}, [
    el('div', { class: 'panel' }, [
      el('label', { text: 'client config (JSON)' }),
      ta,
      el('div', { class: 'row-between', style: 'margin-top:10px' }, [
        el('div', { text: 'API credentials live in env or here — leave blank to keep the memory/placeholder providers.' , class: 'hint' }),
        el('div', { class: 'actions' }, [restoreBtn, saveBtn]),
      ]),
    ]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(ta.value);
    } catch {
      toast('invalid JSON', true);
      return;
    }
    try {
      await clientApi.saveConfig(client.slug, parsed);
      toast('config saved');
      await refreshData();
    } catch (err) {
      fail(err);
    }
  });
  body.append(form);
}

// ---------- documents tab ----------
function renderDocuments(body: HTMLElement, client: Client): void {
  const fileInput = el('input', { type: 'file', accept: '.pdf,.doc,.docx,.txt' });
  const stepSelect = el('select', {}, STEP_IDS.map((s) => el('option', { value: s, text: s })));
  const uploadBtn = el('button', { class: 'primary', type: 'submit', text: 'upload' });
  const form = el('form', { class: 'grid' }, [
    el('div', { class: 'form-field' }, [el('label', { text: 'PDF / document' }), fileInput]),
    el('div', { class: 'form-field' }, [el('label', { text: 'Attach step' }), stepSelect]),
    el('div', { class: 'form-field', style: 'align-self:end' }, [uploadBtn]),
  ]);

  const listBox = el('div');

  async function loadDocs(): Promise<void> {
    const docs = await clientApi.documents(client.slug);
    clear(listBox);
    if (docs.length === 0) {
      listBox.append(el('p', { class: 'hint', text: 'no documents uploaded yet' }));
      return;
    }
    const rows = docs.map((d: DocumentSpec) => {
      const link = el('a', { href: `/files/${d.storageKey ?? d.fileName}`, target: '_blank', text: d.fileName });
      return el('div', { class: 'file-row' }, [
        el('div', {}, [link, el('div', { class: 'hint', text: `${d.step} · ${fmtBytes(d.size)}` })]),
        el('span', { class: 'badge ok', text: 'ready' }),
      ]);
    });
    listBox.append(...rows);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) {
      toast('choose a file first', true);
      return;
    }
    uploadBtn.disabled = true;
    try {
      const r = await clientApi.uploadDocument(client.slug, file, stepSelect.value as StepId);
      toast(`uploaded ${r.document.fileName}`);
      await loadDocs();
      await refreshData();
    } catch (err) {
      fail(err);
    } finally {
      uploadBtn.disabled = false;
    }
  });

  body.append(
    el('div', { class: 'panel' }, [
      el('h3', { text: 'Upload a document' }),
      form,
      el('div', { class: 'alert', text: `Files are served at publicly inspectable URLs under /files/<storageKey> so email clients can open them.` }),
    ]),
    el('div', { class: 'panel' }, [el('h3', { text: 'Documents' }), listBox]),
  );
  void loadDocs();
}

// ---------- data + routing ----------
async function refreshData(): Promise<void> {
  try {
    state.clients = await clientApi.list();
  } catch (err) {
    fail(err);
    state.clients = [];
  }
  renderAll();
}

function renderAll(): void {
  renderSidebar(document.querySelector('#sidebar') as HTMLElement);
  renderMain(document.querySelector('#main') as HTMLElement);
}

function route(): void {
  const m = window.location.hash.match(/^#\/clients\/([^/]+)/);
  state.selectedSlug = m ? decodeURIComponent(m[1]!) : state.selectedSlug;
  renderAll();
}

window.addEventListener('hashchange', route);

renderShell();
void refreshData();
route();
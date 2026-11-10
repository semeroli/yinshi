import { api, toast, getMe, logout, copyText } from './api.js';

const HISTORY_KEY = 'shijing.poems.v1';

const el = (id) => document.getElementById(id);
const ui = {
  form: el('poem-form'),
  description: el('description'),
  charCount: el('char-count'),
  formError: el('form-error'),
  submit: el('submit-btn'),
  empty: el('empty-state'),
  loading: el('loading-state'),
  result: el('poem-result'),
  error: el('error-state'),
  errorMessage: el('error-message'),
  retry: el('btn-retry'),
  modeBadge: el('mode-badge'),
  modeText: el('mode-text'),
  resultMeta: el('result-meta'),
  imageryChips: el('imagery-chips'),
  poemTitle: el('poem-title'),
  poemFormTag: el('poem-form-tag'),
  poemStyleTag: el('poem-style-tag'),
  poemMoodTag: el('poem-mood-tag'),
  poemLines: el('poem-lines'),
  rhymeNote: el('rhyme-note'),
  paraphrase: el('paraphrase'),
  paraphraseList: el('paraphrase-list'),
  validation: el('validation-note'),
  btnAgain: el('btn-again'),
  btnCopy: el('btn-copy'),
  btnSave: el('btn-save'),
  btnParaphrase: el('btn-paraphrase'),
  historyCount: el('history-count'),
  historyList: el('history-list'),
  drawer: el('history-drawer'),
  mask: el('drawer-mask'),
  userName: el('user-name'),
  adminLink: el('admin-link'),
};

const state = {
  form: '自动',
  style: '自动',
  strict: true,
  imagery: null,
  poem: null,
  formUsed: '五言绝句',
  busy: false,
  turnstileToken: '',
};

/* ---------------- 登录态 ---------------- */

const me = await getMe();
if (!me) {
  location.replace('/login.html?next=/app.html');
} else {
  ui.userName.textContent = me.username;
  if (me.is_admin) ui.adminLink.hidden = false;
}

el('btn-logout').addEventListener('click', logout);

/* ---------------- 配置 ---------------- */

try {
  const cfg = await api('/api/config');
  if (cfg.demo) {
    ui.modeBadge.hidden = false;
    ui.modeText.textContent = '演示模式 · 本地诗词库';
  } else {
    ui.modeBadge.hidden = false;
    ui.modeText.textContent = `模型在线 · ${cfg.model}`;
  }
  if (cfg.turnstileSiteKey) mountTurnstile(cfg.turnstileSiteKey);
} catch {
  /* 配置获取失败不阻塞创作 */
}

function mountTurnstile(sitekey) {
  const slot = document.createElement('div');
  slot.id = 'turnstile-slot';
  slot.style.marginBottom = '14px';
  ui.form.insertBefore(slot, ui.formError);
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
  window.__turnstileSitekey = sitekey;
  setTimeout(() => {
    if (window.turnstile) {
      window.turnstile.render(slot, {
        sitekey,
        theme: 'light',
        callback: (token) => {
          state.turnstileToken = token;
        },
        'expired-callback': () => {
          state.turnstileToken = '';
        },
      });
    }
  }, 400);
}

/* ---------------- 选项交互 ---------------- */

document.querySelectorAll('.seg[data-form]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg[data-form]').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');
    state.form = btn.dataset.form;
  });
});

document.querySelectorAll('.chip-btn[data-style]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip-btn[data-style]').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');
    state.style = btn.dataset.style;
  });
});

document.querySelectorAll('.seg[data-strict]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg[data-strict]').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');
    state.strict = btn.dataset.strict === 'true';
  });
});

document.querySelectorAll('.quick').forEach((btn) => {
  btn.addEventListener('click', () => {
    ui.description.value = btn.textContent.trim();
    ui.description.dispatchEvent(new Event('input'));
    ui.description.focus();
  });
});

ui.description.addEventListener('input', () => {
  ui.charCount.textContent = String(ui.description.value.length);
  ui.formError.textContent = '';
});

/* ---------------- 视图切换 ---------------- */

function show(view) {
  ui.empty.hidden = view !== 'empty';
  ui.loading.hidden = view !== 'loading';
  ui.result.hidden = view !== 'result';
  ui.error.hidden = view !== 'error';
}

function setBusy(busy, label = '请君落笔') {
  state.busy = busy;
  ui.submit.disabled = busy;
  ui.btnAgain.disabled = busy;
  ui.submit.innerHTML = busy
    ? '<span class="spinner"></span><span>诗成中…</span>'
    : `<span class="btn-label">${label}</span>`;
}

function progress(step) {
  document.querySelectorAll('.lstep').forEach((node) => {
    const idx = Number(node.dataset.step);
    node.classList.toggle('active', idx === step);
    node.classList.toggle('done', idx < step);
  });
}

/* ---------------- 渲染 ---------------- */

function renderImagery(list) {
  ui.imageryChips.innerHTML = '';
  list.forEach((word, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip on';
    chip.textContent = word;
    chip.style.animationDelay = `${i * 70}ms`;
    ui.imageryChips.appendChild(chip);
  });
}

function renderPoem(data) {
  const { poem, form } = data;
  state.poem = poem;
  state.formUsed = form || state.form;

  ui.poemTitle.textContent = poem.title || '无题';
  ui.poemFormTag.textContent = form;
  const styleName = data.style || '';
  ui.poemStyleTag.textContent = styleName;
  ui.poemStyleTag.hidden = !styleName || styleName === poem.mood;
  ui.poemMoodTag.textContent = poem.mood || '';
  ui.poemMoodTag.hidden = !poem.mood || poem.mood === styleName;

  const rhymeSet = new Set(poem.rhyme_words || []);
  ui.poemLines.innerHTML = '';
  (poem.lines || []).forEach((line, i) => {
    const p = document.createElement('p');
    p.style.setProperty('--i', i);
    const cut = line.length === 7 ? 2 : 2;
    const head = document.createTextNode(line.slice(0, cut));
    const punct1 = document.createElement('span');
    punct1.className = 'punct';
    punct1.textContent = '，';
    const tailText = line.slice(cut);
    const tail = document.createElement('span');
    tail.textContent = tailText;
    const punct2 = document.createElement('span');
    punct2.className = 'punct';
    punct2.textContent = '。';

    if (rhymeSet.has(tailText.slice(-1))) {
      const last = tailText.slice(-1);
      tail.textContent = tailText.slice(0, -1);
      const rhyme = document.createElement('span');
      rhyme.className = 'rhyme';
      rhyme.textContent = last;
      p.append(head, punct1, tail, rhyme, punct2);
    } else {
      p.append(head, punct1, tail, punct2);
    }
    ui.poemLines.appendChild(p);
  });

  ui.rhymeNote.textContent = poem.rhyme_words?.length
    ? `二、四句韵脚：${poem.rhyme_words.join(' · ')}`
    : '';

  ui.paraphraseList.innerHTML = '';
  (poem.paraphrase || []).forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    ui.paraphraseList.appendChild(li);
  });
  ui.paraphrase.hidden = true;
  ui.btnParaphrase.setAttribute('aria-expanded', 'false');

  const demoTag = data.channel === 'demo' ? '演示' : data.channel;
  const cacheTag = data.cached ? ' · 缓存命中' : '';
  ui.resultMeta.textContent = `${demoTag}${cacheTag}`;
  if (data.fallback_reason) {
    ui.resultMeta.textContent += ' · 模型失败';
    ui.resultMeta.title = data.fallback_reason;
    console.warn('[fallback]', data.fallback_reason);
  }

  const ok = data.validation?.ok;
  ui.validation.textContent = ok
    ? `程序校验通过：每句 ${form === '七言绝句' ? 7 : 5} 字，二、四句押韵${data.validation.repaired ? '（已自动修复）' : ''}`
    : `校验提示：${(data.validation?.issues || []).join('；')}`;
}

/* ---------------- 生成 ---------------- */

async function generate({ again = false } = {}) {
  const description = ui.description.value.trim();
  if (!again && description.length < 2) {
    ui.formError.textContent = '请先写下一段意境（至少 2 个字）';
    ui.description.focus();
    return;
  }

  ui.formError.textContent = '';
  setBusy(true);
  show('loading');
  progress(1);

  // 换一首时复用已有意象，避免重复解析
  let imagery = again ? state.imagery : null;
  try {
    if (!imagery) {
      const res = await api('/api/imagery', {
        method: 'POST',
        body: {
          description,
          form: state.form,
          style: state.style,
          turnstileToken: state.turnstileToken,
        },
      });
      imagery = res.imagery;
      state.imagery = imagery;
      renderImagery(imagery.core_imagery || []);
      progress(2);
    }

    const avoid = again && state.poem ? [state.poem.lines.join(' / ')] : [];
    const data = await api('/api/poem', {
      method: 'POST',
      body: {
        imagery,
        form: state.form,
        style: state.style,
        strict: state.strict,
        avoid,
      },
    });
    progress(3);
    await new Promise((r) => setTimeout(r, 260));
    renderPoem(data);
    show('result');
    if (again) toast('已换一首');
  } catch (err) {
    ui.errorMessage.textContent = err.message || '诗兴正浓，稍候再试。';
    show('error');
    if (err.status === 401) setTimeout(() => location.replace('/login.html?next=/app.html'), 1200);
  } finally {
    setBusy(false);
  }
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.busy) return;
  generate();
});

ui.retry.addEventListener('click', () => generate());
ui.btnAgain.addEventListener('click', () => {
  if (!state.busy) generate({ again: true });
});

/* ---------------- 操作 ---------------- */

function poemToText(poem) {
  const lines = (poem.lines || []).map((line) => {
    const cut = line.length === 7 ? 2 : 2;
    return `${line.slice(0, cut)}，${line.slice(cut)}。`;
  });
  return `《${poem.title || '无题'}》\n${lines.join('\n')}\n—— 诗境`;
}

ui.btnCopy.addEventListener('click', async () => {
  if (!state.poem) return;
  const ok = await copyText(poemToText(state.poem));
  toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择', ok ? 'info' : 'error');
});

ui.btnParaphrase.addEventListener('click', () => {
  const open = ui.paraphrase.hidden;
  ui.paraphrase.hidden = !open;
  ui.btnParaphrase.setAttribute('aria-expanded', String(open));
});

/* ---------------- 收藏（localStorage） ---------------- */

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  ui.historyCount.textContent = String(list.length);
  ui.historyList.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hist-empty';
    p.textContent = '诗笺尚空。写完一首，点「收藏」留在这里。';
    ui.historyList.appendChild(p);
    return;
  }
  list.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'hist-item';

    const header = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = item.title;
    const time = document.createElement('time');
    time.textContent = new Date(item.savedAt).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    header.append(h3, time);

    const lines = document.createElement('div');
    lines.className = 'hist-lines';
    item.lines.forEach((l) => {
      const p = document.createElement('p');
      p.textContent = l;
      lines.appendChild(p);
    });

    const footer = document.createElement('footer');
    const meta = document.createElement('span');
    meta.className = 'hint';
    meta.textContent = `${item.form} · ${item.mood || ''}`;
    const del = document.createElement('button');
    del.className = 'hist-del';
    del.type = 'button';
    del.textContent = '移除';
    del.addEventListener('click', () => {
      saveHistory(loadHistory().filter((x) => x.id !== item.id));
      toast('已从诗笺移除');
    });
    footer.append(meta, del);

    card.append(header, lines, footer);
    ui.historyList.appendChild(card);
  });
}

ui.btnSave.addEventListener('click', () => {
  if (!state.poem) return;
  const list = loadHistory();
  const sig = state.poem.lines.join('');
  if (list.some((x) => x.lines.join('') === sig)) {
    toast('这首诗已在诗笺中');
    return;
  }
  list.unshift({
    id: `${Date.now()}`,
    title: state.poem.title || '无题',
    lines: state.poem.lines,
    form: state.formUsed,
    mood: state.poem.mood,
    savedAt: new Date().toISOString(),
  });
  saveHistory(list);
  toast('已收入诗笺');
});

/* ---------------- 抽屉 ---------------- */

function openDrawer() {
  renderHistory();
  ui.mask.hidden = false;
  ui.drawer.classList.add('open');
  ui.drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  ui.drawer.classList.remove('open');
  ui.drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => {
    ui.mask.hidden = true;
  }, 300);
}

el('open-history').addEventListener('click', openDrawer);
el('close-history').addEventListener('click', closeDrawer);
ui.mask.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.drawer.classList.contains('open')) closeDrawer();
});

renderHistory();
ui.description.focus();

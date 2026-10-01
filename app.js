const API = 'https://script.google.com/macros/s/AKfycbx-q6KrRblC-RlBMZiX_HtSLojXTipBDrwVXho1Ifdmk2YlhT_Mo5VqCA4pJI3FHQDx/exec';

// ===== JSONP =====
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    let script = null;

    function cleanup() {
      try { delete window[cb]; } catch (e) {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 20000);

    window[cb] = data => { clearTimeout(timer); resolve(data); cleanup(); };

    script = document.createElement('script');
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('jsonp error')); };
    document.head.appendChild(script);
  });
}

// ===== ID избирателя =====
let voterId = localStorage.getItem('voterId');
if (!voterId) {
  voterId = (crypto.randomUUID && crypto.randomUUID()) ||
            ('v_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  localStorage.setItem('voterId', voterId);
}

// ===== Состояние =====
const State = {
  role: null,
  candidateCode: null,
  blocked: []
};

let selected = null;
const $candidates = document.getElementById('candidates');
const $voteBtn = document.getElementById('voteBtn');
const $msg = document.getElementById('msg');
const $status = document.getElementById('status');
const $roleBadge = document.getElementById('roleBadge');

// ===== Утилиты =====
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function showMsg(text, type) {
  $msg.textContent = text;
  $msg.className = 'msg ' + type;
  $msg.hidden = false;
}

function setStatus(text, online = true) {
  $status.innerHTML = `<span class="dot" style="${online ? '' : 'background:#ff5c7c;box-shadow:0 0 8px #ff5c7c'}"></span>${text}`;
}

// ===== ЭКРАНЫ =====
function showRoleScreen() {
  document.getElementById('roleScreen').hidden = false;
  document.getElementById('codeScreen').hidden = true;
  document.getElementById('voteScreen').hidden = true;
}

function showCodeScreen() {
  document.getElementById('roleScreen').hidden = true;
  document.getElementById('codeScreen').hidden = false;
  document.getElementById('voteScreen').hidden = true;
  setTimeout(() => document.getElementById('candidateCodeInput').focus(), 100);
}

function showVoteScreen() {
  document.getElementById('roleScreen').hidden = true;
  document.getElementById('codeScreen').hidden = true;
  document.getElementById('voteScreen').hidden = false;
}

// ===== РОЛЬ =====
document.getElementById('voterBtn').onclick = () => {
  State.role = 'voter';
  State.candidateCode = null;
  State.blocked = [];
  startVoting();
};

document.getElementById('candidateBtn').onclick = () => {
  showCodeScreen();
};

// ===== КОД КАНДИДАТА =====
document.getElementById('codeBackBtn').onclick = showRoleScreen;
document.getElementById('codeSubmitBtn').onclick = submitCode;
document.getElementById('candidateCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitCode();
});

async function submitCode() {
  const input = document.getElementById('candidateCodeInput');
  const errorBox = document.getElementById('codeError');
  const code = input.value.trim();
  errorBox.textContent = '';

  if (!code) {
    errorBox.textContent = '❌ Введите код';
    return;
  }

  try {
    const res = await jsonp(API + '?action=checkCandidateCode&code=' + encodeURIComponent(code));
    if (res.error) {
      errorBox.textContent = '❌ Неверный код';
      input.style.borderColor = 'var(--error)';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }

    State.role = 'candidate';
    State.candidateCode = code;
    State.blocked = (res.blocked || '').split(',').map(s => s.trim()).filter(Boolean);

    startVoting();
  } catch (err) {
    console.error(err);
    errorBox.textContent = '❌ Ошибка. Попробуй ещё раз';
  }
}

// ===== ГОЛОСОВАНИЕ =====
async function startVoting() {
  showVoteScreen();
  $roleBadge.textContent = State.role === 'candidate' ? 'Кандидат' : 'Голосующий';
  $voteBtn.querySelector('span').textContent = 'Проголосовать';
  $voteBtn.disabled = true;
  document.getElementById('winnerBanner').hidden = true;
  $msg.hidden = true;
  selected = null;

  await loadCandidates();
  await loadStatus();
}

async function loadCandidates() {
  try {
    setStatus('Подключение…', false);
    const data = await jsonp(API + '?action=candidates');
    if (data.error) throw new Error(data.error);

    const list = data.candidates || [];
    if (!list.length) {
      $candidates.innerHTML = '<div class="candidate"><span class="name">Кандидатов нет</span></div>';
      setStatus('Список пуст', false);
      return;
    }

    $candidates.innerHTML = '';
    list.forEach(name => {
      const isBlocked = State.role === 'candidate' && State.blocked.indexOf(name) !== -1;

      const el = document.createElement('div');
      el.className = 'candidate' + (isBlocked ? ' candidate-blocked' : '');
      el.innerHTML = `
        <div class="avatar">${initials(name)}</div>
        <div class="name">${name}</div>
        <div class="check">${isBlocked ? '🚫' : ''}</div>
      `;
      if (!isBlocked) el.onclick = () => select(el, name);
      $candidates.appendChild(el);
    });

    setStatus('Готово к голосованию', true);
  } catch (err) {
    console.error(err);
    $candidates.innerHTML = '<div class="candidate"><span class="name">Не удалось загрузить</span></div>';
    setStatus('Ошибка загрузки', false);
  }
}

function select(el, name) {
  document.querySelectorAll('.candidate').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selected = name;
  $voteBtn.disabled = false;
}

// ===== ГОЛОС =====
$voteBtn.onclick = async () => {
  if (!selected) return;
  $voteBtn.disabled = true;
  $voteBtn.classList.add('loading');

  try {
    await fetch(API, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'vote',
        candidate: selected,
        voterId,
        role: State.role,
        candidateCode: State.candidateCode || ''
      })
    });

    showMsg('Голос учтён. Спасибо!', 'ok');
    setStatus('Голос принят', true);

    document.querySelectorAll('.candidate').forEach(c => {
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.6';
    });
    $voteBtn.querySelector('span').textContent = 'Голос принят';
  } catch (err) {
    console.error(err);
    showMsg('Ошибка. Попробуй ещё раз.', 'err');
    $voteBtn.disabled = false;
  } finally {
    $voteBtn.classList.remove('loading');
  }
};

// ===== СТАТУС =====
async function loadStatus() {
  try {
    const data = await jsonp(API + '?action=status');
    if (!data.finished) return;

    const banner = document.getElementById('winnerBanner');
    document.getElementById('winnerName').textContent = '🏆 ' + data.winner;

    const entries = Object.entries(data.results || {}).sort((a, b) => b[1] - a[1]);
    document.getElementById('winnerStats').innerHTML = entries.map(([n, c]) => {
      const word = c === 1 ? 'голос' : (c < 5 ? 'голоса' : 'голосов');
      return `<div class="row ${n === data.winner ? 'winner' : ''}">
        <span>${n}</span><span>${c} ${word}</span>
      </div>`;
    }).join('');

    banner.hidden = false;

    document.querySelectorAll('.candidate').forEach(c => {
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.4';
    });
    $voteBtn.disabled = true;
    $voteBtn.querySelector('span').textContent = 'Голосование завершено';
  } catch (e) {
    console.warn('status check failed', e);
  }
}

// ===== ВЫХОД =====
document.getElementById('exitBtn').onclick = (e) => {
  e.preventDefault();
  State.role = null;
  State.candidateCode = null;
  State.blocked = [];
  selected = null;
  showRoleScreen();
};

// ===== СТАРТ =====
showRoleScreen();

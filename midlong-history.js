/* ===================================================================
   저장소 헬퍼
=================================================================== */
const hasChromeStorage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);

function storageGet(key, fallback){
  return new Promise((resolve)=>{
    if(hasChromeStorage){
      chrome.storage.local.get([key], (res)=>{
        resolve(res[key] !== undefined ? res[key] : fallback);
      });
    } else {
      try{
        const raw = localStorage.getItem(key);
        resolve(raw ? JSON.parse(raw) : fallback);
      }catch(e){ resolve(fallback); }
    }
  });
}
function storageSet(key, value){
  return new Promise((resolve)=>{
    if(hasChromeStorage){
      chrome.storage.local.set({[key]: value}, resolve);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
}

function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0');
}
function formatMD(dateStr){
  const m = dateStr && dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : (dateStr || '');
}
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

const PRIORITY_ORDER = { high:0, medium:1, low:2 };
const PRIORITY_COLOR = { high:'var(--coral)', medium:'var(--lavender-deep)', low:'var(--mint-deep)' };
// 시작일~완료목표일 기준 경과율과 D-day 라벨을 계산합니다.
function computeMidLongProgress(m){
  const start = new Date(m.startDate+'T00:00:00');
  const due = new Date(m.dueDate+'T00:00:00');
  const today = new Date(todayStr()+'T00:00:00');
  const totalDays = Math.max(1, Math.round((due-start)/86400000));
  const elapsedDays = Math.round((today-start)/86400000);
  const pct = Math.min(100, Math.max(0, Math.round((elapsedDays/totalDays)*100)));
  const daysLeft = Math.round((due-today)/86400000);
  let label;
  if(daysLeft > 0) label = `D-${daysLeft}`;
  else if(daysLeft === 0) label = 'D-day';
  else label = `${Math.abs(daysLeft)}일 지남`;
  return { pct, label, overdue: daysLeft < 0 };
}

let ALL_MIDLONG = [];
let ALL_TASKS = [];
let expandedIds = new Set();
let currentModalId = null;

async function loadData(){
  ALL_MIDLONG = await storageGet('midLongTasks', []);
  ALL_TASKS = await storageGet('personalTasks', []);
  render();
}

/* ===================================================================
   정렬 + 검색
=================================================================== */
function getSorted(searchTerm){
  const term = (searchTerm||'').trim().toLowerCase();
  let list = ALL_MIDLONG.slice();
  if(term) list = list.filter(m => (m.title||'').toLowerCase().includes(term));
  return list.sort((a,b)=>{
    if(a.done !== b.done) return a.done ? 1 : -1; // 미완료가 항상 위
    if(!a.done){
      const pa = PRIORITY_ORDER[a.priority] ?? 1;
      const pb = PRIORITY_ORDER[b.priority] ?? 1;
      if(pa !== pb) return pa - pb;
      return (a.dueDate||'').localeCompare(b.dueDate||'');
    }
    const da = a.completedAt || a.dueDate || '';
    const db = b.completedAt || b.dueDate || '';
    if(da !== db) return db.localeCompare(da); // 최근 완료 먼저
    return (b.id||0) - (a.id||0);
  });
}

function render(){
  const term = document.getElementById('searchInput').value;
  const list = getSorted(term);
  const wrap = document.getElementById('listWrap');

  if(list.length === 0){
    wrap.innerHTML = '<div class="empty">해당하는 과제가 없어요</div>';
    return;
  }

  wrap.innerHTML = list.map(m=>{
    const subtasks = ALL_TASKS.filter(t=>t.midLongId===m.id);
    const doneCount = subtasks.filter(t=>t.done).length;
    const isExpanded = expandedIds.has(m.id);
    const prog = computeMidLongProgress(m);
    const metaText = m.done ? `완료 · ${formatMD(m.completedAt || m.dueDate)}` : prog.label;

    return `
      <div class="project-card" data-id="${m.id}">
        <div class="project-row">
          <input type="checkbox" data-id="${m.id}" ${m.done ? 'checked' : ''}>
          <span class="priority-dot" style="background:${PRIORITY_COLOR[m.priority] || PRIORITY_COLOR.medium}"></span>
          <div class="project-main" data-id="${m.id}">
            <div class="project-title ${m.done ? 'done' : ''}">${escapeHtml(m.title)}</div>
            <div class="project-dates">📅 ${formatMD(m.startDate)} ~ ${formatMD(m.dueDate)}</div>
            ${!m.done ? `
              <div class="midlong-progress-wrap">
                <div class="midlong-progress-bar"><div class="midlong-progress-fill ${prog.overdue?'overdue':''}" style="width:${prog.pct}%"></div></div>
              </div>
            ` : ''}
          </div>
          <span class="project-meta ${m.done ? 'done' : (prog.overdue ? 'overdue' : '')}">${metaText}</span>
          ${subtasks.length ? `<button class="project-toggle" data-id="${m.id}">${isExpanded ? '▾' : '▸'} 하부업무 ${doneCount}/${subtasks.length}</button>` : ''}
        </div>
        ${isExpanded && subtasks.length ? `
          <div class="subtasks">
            ${subtasks.map(t=>`<div class="subtask-row ${t.done ? 'done' : ''}" data-id="${t.id}"><span class="sub-dot"></span>${escapeHtml(t.text)}${t.memo || t.link ? ' <span class="memo-mark" title="메모 있음">📝</span>' : ''}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.project-row input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('click', (e)=> e.stopPropagation());
    cb.addEventListener('change', async (e)=>{
      const id = Number(e.target.dataset.id);
      const m = ALL_MIDLONG.find(x=>x.id===id);
      if(m){
        m.done = e.target.checked;
        m.completedAt = e.target.checked ? todayStr() : null;
        await storageSet('midLongTasks', ALL_MIDLONG);
        render();
      }
    });
  });

  wrap.querySelectorAll('.project-toggle').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = Number(e.currentTarget.dataset.id);
      if(expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
      render();
    });
  });

  wrap.querySelectorAll('.project-main').forEach(main=>{
    main.addEventListener('click', ()=> openModal(Number(main.dataset.id)));
  });
  wrap.querySelectorAll('.subtask-row').forEach(row=>{
    row.addEventListener('click', ()=> openTaskDetailModal(Number(row.dataset.id)));
  });
}

/* ===================================================================
   상세 편집 모달
=================================================================== */
function openModal(id){
  const m = ALL_MIDLONG.find(x=>x.id===id);
  if(!m) return;
  currentModalId = id;
  document.getElementById('midLongModalTitleInput').value = m.title || '';
  document.getElementById('midLongModalPriority').value = m.priority || 'medium';
  document.getElementById('midLongModalStart').value = m.startDate || '';
  document.getElementById('midLongModalDue').value = m.dueDate || '';
  document.getElementById('midLongModalMemo').value = m.memo || '';
  document.getElementById('midLongModalLink').value = m.link || '';
  updateLinkPreview(m.link || '');
  document.getElementById('midLongModalOverlay').style.display = 'flex';
}
function closeModal(){
  document.getElementById('midLongModalOverlay').style.display = 'none';
  currentModalId = null;
}
async function saveModal(){
  const m = ALL_MIDLONG.find(x=>x.id===currentModalId);
  if(!m) return;
  const start = document.getElementById('midLongModalStart').value;
  const due = document.getElementById('midLongModalDue').value;
  if(!start || !due){
    alert('시작일과 완료목표일을 모두 선택해주세요.');
    return;
  }
  const newTitle = document.getElementById('midLongModalTitleInput').value.trim();
  if(newTitle) m.title = newTitle;
  m.priority = document.getElementById('midLongModalPriority').value;
  m.startDate = start;
  m.dueDate = due;
  m.memo = document.getElementById('midLongModalMemo').value;
  m.link = document.getElementById('midLongModalLink').value.trim();
  await storageSet('midLongTasks', ALL_MIDLONG);
  closeModal();
  render();
}
function updateLinkPreview(link){
  const el = document.getElementById('midLongModalLinkPreview');
  el.innerHTML = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(link)}</a>` : '';
}

document.getElementById('midLongModalClose').addEventListener('click', closeModal);
document.getElementById('midLongModalCancel').addEventListener('click', closeModal);
document.getElementById('midLongModalSave').addEventListener('click', saveModal);
document.getElementById('midLongModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'midLongModalOverlay') closeModal();
});
document.getElementById('midLongModalLink').addEventListener('input', (e)=> updateLinkPreview(e.target.value.trim()));
document.getElementById('midLongModalDelete').addEventListener('click', async ()=>{
  if(currentModalId == null) return;
  ALL_MIDLONG = ALL_MIDLONG.filter(m=>m.id!==currentModalId);
  await storageSet('midLongTasks', ALL_MIDLONG);
  closeModal();
  render();
});

document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('backLink').addEventListener('click', (e)=>{
  e.preventDefault();
  window.close();
});

/* ===================================================================
   하부 업무(일반 업무) 상세 편집 — 오늘의 업무와 동일한 데이터를 사용합니다.
=================================================================== */
let currentTaskModalId = null;

function populateTaskMidLongSelect(selectedId){
  const sel = document.getElementById('taskModalMidLong');
  const options = ['<option value="">일반 업무 (선택 안 함)</option>']
    .concat(ALL_MIDLONG.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`));
  sel.innerHTML = options.join('');
  sel.value = selectedId ? String(selectedId) : '';
}

function openTaskDetailModal(id){
  const t = ALL_TASKS.find(x=>x.id===id);
  if(!t) return;
  currentTaskModalId = id;
  document.getElementById('taskModalTitleInput').value = t.text || '';
  populateTaskMidLongSelect(t.midLongId);
  document.getElementById('taskModalPriority').value = t.priority || 'medium';
  document.getElementById('taskModalDueDate').value = t.dueDate || '';
  document.getElementById('taskModalMemo').value = t.memo || '';
  document.getElementById('taskModalLink').value = t.link || '';
  updateTaskLinkPreview(t.link || '');
  document.getElementById('taskModalOverlay').style.display = 'flex';
}
function closeTaskDetailModal(){
  document.getElementById('taskModalOverlay').style.display = 'none';
  currentTaskModalId = null;
}
async function saveTaskDetailModal(){
  const t = ALL_TASKS.find(x=>x.id===currentTaskModalId);
  if(!t) return;
  const newText = document.getElementById('taskModalTitleInput').value.trim();
  if(newText) t.text = newText;
  const midLongVal = document.getElementById('taskModalMidLong').value;
  t.midLongId = midLongVal ? Number(midLongVal) : null;
  t.priority = document.getElementById('taskModalPriority').value;
  t.dueDate = document.getElementById('taskModalDueDate').value || null;
  t.memo = document.getElementById('taskModalMemo').value;
  t.link = document.getElementById('taskModalLink').value.trim();
  await storageSet('personalTasks', ALL_TASKS);
  closeTaskDetailModal();
  render();
}
function updateTaskLinkPreview(link){
  const el = document.getElementById('taskModalLinkPreview');
  el.innerHTML = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(link)}</a>` : '';
}

document.getElementById('taskModalClose').addEventListener('click', closeTaskDetailModal);
document.getElementById('taskModalCancel').addEventListener('click', closeTaskDetailModal);
document.getElementById('taskModalSave').addEventListener('click', saveTaskDetailModal);
document.getElementById('taskModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'taskModalOverlay') closeTaskDetailModal();
});
document.getElementById('taskModalLink').addEventListener('input', (e)=> updateTaskLinkPreview(e.target.value.trim()));
document.getElementById('taskModalDelete').addEventListener('click', async ()=>{
  if(currentTaskModalId == null) return;
  ALL_TASKS = ALL_TASKS.filter(t=>t.id!==currentTaskModalId);
  await storageSet('personalTasks', ALL_TASKS);
  closeTaskDetailModal();
  render();
});

// 다른 탭에서 데이터를 바꾸면 이 페이지도 자동으로 최신 상태로 갱신합니다.
if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged){
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area !== 'local') return;
    if(changes.personalTasks || changes.midLongTasks){
      loadData();
    }
  });
}

loadData();

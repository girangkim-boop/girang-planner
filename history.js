/* ===================================================================
   저장소 헬퍼 (index.html/planner.js와 동일한 방식)
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
const PRIORITY_LABEL = { high:'높음', medium:'보통', low:'낮음' };
const PRIORITY_COLOR = { high:'var(--coral)', medium:'var(--lavender-deep)', low:'var(--mint-deep)' };

let ALL_TASKS = [];
let ALL_MIDLONG = [];
let currentModalTaskId = null;

/* ===================================================================
   데이터 로드
=================================================================== */
async function loadTasks(){
  ALL_TASKS = await storageGet('personalTasks', []);
  ALL_MIDLONG = await storageGet('midLongTasks', []);
  render();
}

/* ===================================================================
   월별 그룹핑 + 정렬 + 검색
=================================================================== */
function groupByMonth(tasks){
  const groups = {}; // "2026-07" -> [tasks]
  tasks.forEach(t=>{
    const key = (t.date || todayStr()).slice(0,7);
    if(!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return groups;
}
function sortTasksWithinGroup(list){
  return list.slice().sort((a,b)=>{
    if(a.done !== b.done) return a.done ? 1 : -1; // 미완료가 항상 위
    if(!a.done){
      const pa = PRIORITY_ORDER[a.priority] ?? 1;
      const pb = PRIORITY_ORDER[b.priority] ?? 1;
      if(pa !== pb) return pa - pb;
      return (a.id||0) - (b.id||0);
    }
    const da = a.completedAt || a.date || '';
    const db = b.completedAt || b.date || '';
    if(da !== db) return db.localeCompare(da); // 최근 완료 먼저
    return (b.id||0) - (a.id||0);
  });
}
function monthLabel(key){
  const [y,m] = key.split('-');
  return `${y}년 ${Number(m)}월`;
}

// 기간(여러 날) 일정에서 자동 생성된 날짜별 업무들을 하나의 항목으로 합칩니다.
function mergeEventTasks(tasks){
  const byEvent = {};
  const result = [];
  tasks.forEach(t=>{
    if(t.fromEventId){
      if(!byEvent[t.fromEventId]) byEvent[t.fromEventId] = [];
      byEvent[t.fromEventId].push(t);
    } else {
      result.push(t);
    }
  });
  Object.keys(byEvent).forEach(eventId=>{
    const members = byEvent[eventId].slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
    if(members.length === 1){ result.push(members[0]); return; } // 하루짜리는 그대로
    const allDone = members.every(m=>m.done);
    const doneCount = members.filter(m=>m.done).length;
    const completedDates = members.filter(m=>m.done).map(m=>m.completedAt||m.date).sort();
    result.push({
      id: members[0].id,
      text: members[0].text,
      date: members[0].date, // 시작일 기준으로 월 그룹핑
      done: allDone,
      priority: members[0].priority,
      memo: members[0].memo,
      link: members[0].link,
      dueDate: members[0].dueDate,
      midLongId: members[0].midLongId,
      completedAt: allDone ? completedDates[completedDates.length-1] : null,
      isMerged: true,
      fromEventId: eventId,
      memberIds: members.map(m=>m.id),
      doneCount,
      totalCount: members.length,
      rangeStart: members[0].date,
      rangeEnd: members[members.length-1].date
    });
  });
  return result;
}

function render(){
  const term = document.getElementById('searchInput').value.trim().toLowerCase();
  let tasks = ALL_TASKS.slice();
  if(term){
    tasks = tasks.filter(t => (t.text||'').toLowerCase().includes(term));
  }
  tasks = mergeEventTasks(tasks);

  const groups = groupByMonth(tasks);
  const monthKeys = Object.keys(groups).sort().reverse(); // 최근 달이 위로
  const currentMonthKey = todayStr().slice(0,7);
  const wrap = document.getElementById('groupsWrap');

  if(monthKeys.length === 0){
    wrap.innerHTML = '<div class="empty">해당하는 업무가 없어요</div>';
    return;
  }

  wrap.innerHTML = monthKeys.map(key=>{
    const list = sortTasksWithinGroup(groups[key]);
    const shouldOpen = term ? true : (key === currentMonthKey);
    const rows = list.map(t=>{
      let metaText;
      if(t.isMerged){
        metaText = t.done
          ? `완료 · ${formatMD(t.rangeStart)}~${formatMD(t.rangeEnd)}`
          : `${t.doneCount}/${t.totalCount} 완료 · ${formatMD(t.rangeStart)}~${formatMD(t.rangeEnd)}`;
      } else {
        metaText = t.done
          ? `완료 · ${formatMD(t.completedAt || t.date)}`
          : `등록 · ${formatMD(t.date)}`;
      }
      const midLong = t.midLongId ? ALL_MIDLONG.find(m=>m.id===t.midLongId) : null;
      return `
        <div class="task-row ${t.done ? 'done' : ''}" data-id="${t.id}" ${t.isMerged ? `data-member-ids="${t.memberIds.join(',')}"` : ''}>
          <input type="checkbox" data-id="${t.id}" ${t.isMerged ? `data-member-ids="${t.memberIds.join(',')}"` : ''} ${t.done ? 'checked' : ''}>
          <span class="priority-dot" style="background:${PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.medium}"></span>
          <label data-id="${t.id}">${midLong ? `<span class="midlong-tag">📌 ${escapeHtml(midLong.title)}</span><br>` : ''}${t.isMerged ? '<span class="period-tag">📅 기간</span> ' : ''}${escapeHtml(t.text)}${t.memo || t.link ? '<span class="memo-mark" title="메모 있음">📝</span>' : ''}${t.dueDate ? `<span class="due-tag ${(!t.done && t.dueDate < todayStr()) ? 'overdue' : ''}">🎯${formatMD(t.dueDate)}</span>` : ''}</label>
          <span class="meta">${metaText}</span>
        </div>
      `;
    }).join('');

    return `
      <details class="month-group" ${shouldOpen ? 'open' : ''} data-month="${key}">
        <summary>
          <span><span class="chevron">▶</span> ${monthLabel(key)}<span class="count">(${list.length}개)</span></span>
        </summary>
        <div class="month-body">${rows}</div>
      </details>
    `;
  }).join('');

  wrap.querySelectorAll('.task-row input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('click', (e)=> e.stopPropagation());
    cb.addEventListener('change', async (e)=>{
      const memberIdsAttr = e.target.dataset.memberIds;
      if(memberIdsAttr){
        // 기간 병합 항목: 모든 날짜의 업무를 한꺼번에 체크/해제
        const ids = memberIdsAttr.split(',').map(Number);
        ids.forEach(id=>{
          const t = ALL_TASKS.find(x=>x.id===id);
          if(t){ t.done = e.target.checked; t.completedAt = e.target.checked ? todayStr() : null; }
        });
        await storageSet('personalTasks', ALL_TASKS);
        render();
        return;
      }
      const id = Number(e.target.dataset.id);
      const t = ALL_TASKS.find(x=>x.id===id);
      if(t){
        t.done = e.target.checked;
        t.completedAt = e.target.checked ? todayStr() : null;
        await storageSet('personalTasks', ALL_TASKS);
        render();
      }
    });
  });

  wrap.querySelectorAll('.task-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const memberIdsAttr = row.dataset.memberIds;
      const memberIds = memberIdsAttr ? memberIdsAttr.split(',').map(Number) : null;
      openTaskModal(Number(row.dataset.id), memberIds);
    });
  });
}

/* ===================================================================
   상세 편집 모달
=================================================================== */
function populateMidLongSelect(selectedId){
  const sel = document.getElementById('taskModalMidLong');
  const options = ['<option value="">일반 업무 (선택 안 함)</option>']
    .concat(ALL_MIDLONG.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`));
  sel.innerHTML = options.join('');
  sel.value = selectedId ? String(selectedId) : '';
}

let currentModalMemberIds = null;

function openTaskModal(id, memberIds){
  const t = ALL_TASKS.find(x=>x.id===id);
  if(!t) return;
  currentModalTaskId = id;
  currentModalMemberIds = memberIds || null;
  document.getElementById('taskModalTitleInput').value = t.text || '';
  populateMidLongSelect(t.midLongId);
  document.getElementById('taskModalPriority').value = t.priority || 'medium';
  document.getElementById('taskModalDueDate').value = t.dueDate || '';
  document.getElementById('taskModalMemo').value = t.memo || '';
  document.getElementById('taskModalLink').value = t.link || '';
  updateLinkPreview(t.link || '');
  document.getElementById('taskModalOverlay').style.display = 'flex';
}
function closeTaskModal(){
  document.getElementById('taskModalOverlay').style.display = 'none';
  currentModalTaskId = null;
  currentModalMemberIds = null;
}
async function saveTaskModal(){
  const targetIds = currentModalMemberIds || [currentModalTaskId];
  const newText = document.getElementById('taskModalTitleInput').value.trim();
  const midLongVal = document.getElementById('taskModalMidLong').value;
  const priority = document.getElementById('taskModalPriority').value;
  const dueDate = document.getElementById('taskModalDueDate').value || null;
  const memo = document.getElementById('taskModalMemo').value;
  const link = document.getElementById('taskModalLink').value.trim();

  targetIds.forEach(id=>{
    const t = ALL_TASKS.find(x=>x.id===id);
    if(!t) return;
    if(newText) t.text = newText;
    t.midLongId = midLongVal ? Number(midLongVal) : null;
    t.priority = priority;
    t.dueDate = dueDate;
    t.memo = memo;
    t.link = link;
  });
  await storageSet('personalTasks', ALL_TASKS);
  closeTaskModal();
  render();
}
function updateLinkPreview(link){
  const el = document.getElementById('taskModalLinkPreview');
  el.innerHTML = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(link)}</a>` : '';
}

document.getElementById('taskModalClose').addEventListener('click', closeTaskModal);
document.getElementById('taskModalCancel').addEventListener('click', closeTaskModal);
document.getElementById('taskModalSave').addEventListener('click', saveTaskModal);
document.getElementById('taskModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'taskModalOverlay') closeTaskModal();
});
document.getElementById('taskModalLink').addEventListener('input', (e)=> updateLinkPreview(e.target.value.trim()));
document.getElementById('taskModalDelete').addEventListener('click', async ()=>{
  if(currentModalTaskId == null) return;
  const targetIds = currentModalMemberIds || [currentModalTaskId];
  ALL_TASKS = ALL_TASKS.filter(t=>!targetIds.includes(t.id));
  await storageSet('personalTasks', ALL_TASKS);
  closeTaskModal();
  render();
});

document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('backLink').addEventListener('click', (e)=>{
  e.preventDefault();
  window.close();
});

// 다른 탭에서 데이터를 바꾸면 이 페이지도 자동으로 최신 상태로 갱신합니다.
if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged){
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area !== 'local') return;
    if(changes.personalTasks || changes.midLongTasks){
      loadTasks();
    }
  });
}

loadTasks();

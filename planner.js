/* ===================================================================
   저장소 헬퍼
   - 크롬 확장 안에서 열리면 chrome.storage.local 사용 (스마트오피스 확장과 데이터 공유)
   - 그냥 파일로 열어서 미리보기 하는 경우엔 localStorage로 자동 대체
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
  }).then(()=>{
    if(typeof scheduleCloudPush === 'function') scheduleCloudPush(key);
  });
}

/* ===================================================================
   기본 데이터 (처음 실행 시 채워지는 예시 데이터)
=================================================================== */
const DEFAULT_MEETINGS = [
  { date: todayStr(), time:"10:00-11:00", title:"주간 팀 회의" },
  { date: todayStr(), time:"14:00-14:30", title:"고객사 화상미팅" }
];
const DEFAULT_TASKS = [
  { id:1, text:"주간 보고서 작성", done:false, date: todayStr(), priority:"high", memo:"", link:"", completedAt:null, dueDate:null, midLongId:null },
  { id:2, text:"이메일 회신", done:true, date: todayStr(), priority:"medium", memo:"", link:"", completedAt: todayStr(), dueDate:null, midLongId:null },
  { id:3, text:"디자인 시안 검토", done:false, date: todayStr(), priority:"low", memo:"", link:"", completedAt:null, dueDate:null, midLongId:null }
];
const DEFAULT_LEAVE = []; // 예: ["2026-07-25"]
const DEFAULT_MIDLONG = [
  { id:1, title:"3분기 기획안 초안", startDate: todayStr(), dueDate:"2026-08-10", priority:"high", done:false, completedAt:null, memo:"", link:"" },
  { id:2, title:"신규 프로젝트 킥오프", startDate: todayStr(), dueDate:"2026-08-20", priority:"medium", done:false, completedAt:null, memo:"", link:"" }
];
const DEFAULT_TEAM = [
  { date:"07/22", text:"디자인팀 워크숍" },
  { date:"07/24", text:"분기 목표 리뷰" }
];

const KR_HOLIDAYS_2026 = {
  "2026-01-01":"신정",
  "2026-02-16":"설날 연휴",
  "2026-02-17":"설날",
  "2026-02-18":"설날 연휴",
  "2026-03-01":"삼일절",
  "2026-03-02":"대체공휴일(삼일절)",
  "2026-05-01":"노동절",
  "2026-05-05":"어린이날",
  "2026-05-24":"부처님오신날",
  "2026-05-25":"대체공휴일(부처님오신날)",
  "2026-06-06":"현충일",
  "2026-07-17":"제헌절",
  "2026-08-15":"광복절",
  "2026-08-17":"대체공휴일(광복절)",
  "2026-09-24":"추석 연휴",
  "2026-09-25":"추석",
  "2026-09-26":"추석 연휴",
  "2026-10-03":"개천절",
  "2026-10-05":"대체공휴일(개천절)",
  "2026-10-09":"한글날",
  "2026-12-25":"크리스마스"
};

function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0');
}
// 예전 형식의 업무(날짜/중요도/메모/링크 필드가 없는 경우)를 보정합니다.
function normalizeTasks(tasks){
  let changed = false;
  const today = todayStr();
  const result = (tasks||[]).map(t=>{
    const fixed = { ...t };
    if(!fixed.date){ fixed.date = today; changed = true; }
    if(!fixed.priority){ fixed.priority = 'medium'; changed = true; }
    if(fixed.memo === undefined){ fixed.memo = ''; changed = true; }
    if(fixed.link === undefined){ fixed.link = ''; changed = true; }
    if(fixed.completedAt === undefined){ fixed.completedAt = fixed.done ? (fixed.date || today) : null; changed = true; }
    if(fixed.dueDate === undefined){ fixed.dueDate = null; changed = true; }
    if(fixed.midLongId === undefined){ fixed.midLongId = null; changed = true; }
    return fixed;
  });
  return { tasks: result, changed };
}
// 예전 형식의 중장기 과제(필드가 부족한 경우)를 보정합니다.
function normalizeMidLong(list){
  let changed = false;
  let nextId = 1;
  const today = todayStr();
  const result = (list||[]).map(m=>{
    const fixed = { ...m };
    if(!fixed.id){ fixed.id = nextId; changed = true; }
    nextId = Math.max(nextId, fixed.id+1);
    if(!fixed.dueDate){ fixed.dueDate = fixed.due || today; changed = true; }
    if(fixed.due !== undefined){ delete fixed.due; changed = true; }
    if(!fixed.startDate){ fixed.startDate = today; changed = true; }
    if(!fixed.priority){ fixed.priority = 'medium'; changed = true; }
    if(fixed.done === undefined){ fixed.done = false; changed = true; }
    if(fixed.completedAt === undefined){ fixed.completedAt = fixed.done ? today : null; changed = true; }
    if(fixed.memo === undefined){ fixed.memo = ''; changed = true; }
    if(fixed.link === undefined){ fixed.link = ''; changed = true; }
    return fixed;
  });
  return { list: result, changed };
}
// 업무에 완료목표일(dueDate)이 등록일보다 뒤로 설정되어 있으면, 등록일~목표일
// 사이의 모든 날짜에서 "그날의 업무"로 취급합니다(기간 업무). 없거나 등록일과
// 같으면 기존처럼 date와 정확히 일치하는 날짜에서만 표시됩니다.
function isTaskOnDate(t, dateStr){
  if(t.dueDate && t.dueDate >= t.date){
    return dateStr >= t.date && dateStr <= t.dueDate;
  }
  return t.date === dateStr;
}

// 오늘 화면에 보여줄 업무: 오늘 날짜(또는 기간에 포함된) 업무 + 어제 이전 날짜인데
// 아직 완료 안 된 업무(이월)
// 진행률(도넛+꽃)은 조회 중인 날짜와 무관하게 항상 '실제 오늘' 기준으로 계산합니다.
function getTodayTasksForProgress(){
  const today = todayStr();
  return STATE.tasks.filter(t => isTaskOnDate(t, today) || (!t.done && t.date < today));
}

function getVisibleTasks(){
  const today = todayStr();
  const viewDate = STATE.taskViewDate || today;
  const PRIORITY_ORDER = { high:0, medium:1, low:2 };
  let list;
  if(viewDate === today){
    // 오늘: 오늘 날짜(또는 기간에 포함된) 업무 + 어제 이전인데 아직 완료 안 된 업무(이월)
    // 단, 스마트오피스 회의에서 자동 생성된 업무는 이월하지 않습니다.
    list = STATE.tasks.filter(t => isTaskOnDate(t, today) || (!t.done && t.date < today && !t.fromMeetingKey));
  } else {
    // 다른 날짜를 조회 중이면, 그 날짜에 해당하는(기간 포함) 업무만 보여줍니다.
    list = STATE.tasks.filter(t => isTaskOnDate(t, viewDate));
  }
  return list
    .slice()
    .sort((a,b)=>{
      if(a.done !== b.done) return a.done ? 1 : -1;
      const pa = PRIORITY_ORDER[a.priority] ?? 1;
      const pb = PRIORITY_ORDER[b.priority] ?? 1;
      if(pa !== pb) return pa - pb;
      return (a.id||0) - (b.id||0);
    });
}
const PRIORITY_LABEL = { high:'높음', medium:'보통', low:'낮음' };
const PRIORITY_COLOR = { high:'var(--coral)', medium:'var(--lavender-deep)', low:'var(--mint-deep)' };
const PRIORITY_ORDER_MAP = { high:0, medium:1, low:2 };
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
// 미완료가 항상 위(중요도순), 완료는 최근 완료일 순으로 정렬 (검색어 있으면 필터링)
function getSortedMidLong(searchTerm){
  const term = (searchTerm||'').trim().toLowerCase();
  let list = STATE.midlong.slice();
  if(term) list = list.filter(m => (m.title||'').toLowerCase().includes(term));
  return list.sort((a,b)=>{
    if(a.done !== b.done) return a.done ? 1 : -1;
    if(!a.done){
      const pa = PRIORITY_ORDER_MAP[a.priority] ?? 1;
      const pb = PRIORITY_ORDER_MAP[b.priority] ?? 1;
      if(pa !== pb) return pa - pb;
      return (a.dueDate||'').localeCompare(b.dueDate||'');
    }
    const da = a.completedAt || a.dueDate || '';
    const db = b.completedAt || b.dueDate || '';
    if(da !== db) return db.localeCompare(da);
    return (b.id||0) - (a.id||0);
  });
}
// 연차 목록(문자열 배열 또는 {date,time} 객체 배열)을 { "2026-07-20": "종일" } 형태로 변환
function toLeaveMap(arr){
  const map = {};
  (arr||[]).forEach(item=>{
    if(typeof item === 'string'){ map[item] = '종일'; }
    else if(item && item.date){ map[item.date] = item.time || '종일'; }
  });
  return map;
}

/* ===================================================================
   초기화
=================================================================== */
let STATE = {
  meetings: [],
  syncedMeetings: [],
  personalEvents: [],
  tasks: [],
  leave: [],
  midlong: [],
  team: [],
  calDate: new Date(),
  selectedDate: todayStr(),
  teamWeekStart: startOfWeek(new Date()),
  taskViewDate: todayStr()
};

// 일요일을 한 주의 시작으로 봅니다.
function startOfWeek(d){
  const copy = new Date(d);
  copy.setHours(0,0,0,0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}
function dateToStr(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0');
}

// 직접 추가한 일정(기간 가능)을 날짜별 항목으로 펼칩니다.
function expandPersonalEvents(events){
  const result = [];
  (events||[]).forEach(ev=>{
    const start = new Date(ev.startDate+'T00:00:00');
    const end = new Date((ev.endDate || ev.startDate)+'T00:00:00');
    if(isNaN(start) || isNaN(end)) return;
    let cur = new Date(start);
    let guard = 0;
    while(cur <= end && guard < 366){
      result.push({
        date: dateToStr(cur),
        time: `${ev.startTime}-${ev.endTime}`,
        title: ev.title,
        rooms: '',
        attendees: '',
        memo: ev.memo || '',
        manual: true,
        eventId: ev.id
      });
      cur.setDate(cur.getDate()+1);
      guard++;
    }
  });
  return result;
}
// STATE.meetings = 스마트오피스 동기화 회의 + 직접 추가한 일정(펼친 것)
function recomputeMeetings(){
  STATE.meetings = STATE.syncedMeetings.concat(expandPersonalEvents(STATE.personalEvents));
}

// 스마트오피스에서 동기화된 회의를 '오늘의 업무'에도 자동으로 반영합니다.
// (이미 만들어둔 업무는 건드리지 않고, 새로 생긴 회의만 추가하고, 사라진 회의의
// 업무만 정리해요 — 그래야 체크 표시한 게 재동기화 때마다 없어지지 않아요)
function syncTasksFromMeetings(){
  const existingKeys = new Set(STATE.tasks.filter(t=>t.fromMeetingKey).map(t=>t.fromMeetingKey));
  const currentMeetingKeys = new Set();
  let changed = false;
  const todayS = todayStr();
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();

  STATE.syncedMeetings.forEach(m=>{
    if(!m.date) return;
    const key = `${m.date}|${m.time||''}|${m.title||''}`;
    currentMeetingKeys.add(key);
    let task = STATE.tasks.find(t => t.fromMeetingKey === key);
    if(!task){
      const nextId = STATE.tasks.length ? Math.max(...STATE.tasks.map(t=>t.id)) + 1 : 1;
      task = {
        id: nextId,
        text: m.title || '제목 없음',
        done: false,
        date: m.date,
        priority: 'medium',
        memo: '',
        link: '',
        completedAt: null,
        dueDate: null,
        midLongId: null,
        fromMeetingKey: key
      };
      STATE.tasks.push(task);
      existingKeys.add(key);
      changed = true;
    }

    // 회의 시간이 지났으면 자동으로 완료 체크
    if(!task.done){
      const endStr = (m.time || '').split('-')[1];
      const endMin = endStr ? timeToMinutes(endStr.trim()) : null;
      const isPast = m.date < todayS || (m.date === todayS && endMin !== null && nowMin >= endMin);
      if(isPast){
        task.done = true;
        task.completedAt = todayS;
        changed = true;
      }
    }
  });

  // 더 이상 동기화되지 않는(취소되었거나 지나간 회의) 자동 생성 업무는 정리합니다.
  const before = STATE.tasks.length;
  STATE.tasks = STATE.tasks.filter(t => !t.fromMeetingKey || currentMeetingKeys.has(t.fromMeetingKey));
  if(STATE.tasks.length !== before) changed = true;

  return changed;
}

async function init(){
  const synced = await storageGet('fursysPlannerData', null); // 확장프로그램이 넣어주는 회의 데이터
  const flexSynced = await storageGet('flexLeaveData', null); // 확장프로그램이 넣어주는 Flex 연차 데이터
  const rawTasks = await storageGet('personalTasks', null);
  const tasks = rawTasks || DEFAULT_TASKS;
  const leaveFallback = await storageGet('annualLeave', DEFAULT_LEAVE);
  const rawMidlong = await storageGet('midLongTasks', null);
  const midlong = rawMidlong || DEFAULT_MIDLONG;
  const teamFallback = await storageGet('teamSchedule', DEFAULT_TEAM);
  const personalEvents = await storageGet('personalEvents', []);

  const hasRealSyncedMeetings = !!(synced && synced.meetings && synced.meetings.length);
  STATE.hasRealSyncedMeetings = hasRealSyncedMeetings;
  STATE.syncedMeetings = hasRealSyncedMeetings ? synced.meetings : DEFAULT_MEETINGS;
  STATE.personalEvents = personalEvents;
  recomputeMeetings();
  const midlongNorm = normalizeMidLong(midlong);
  STATE.midlong = midlongNorm.list;
  // ⚠️ 저장소에 값이 원래 없어서 예시(더미) 데이터를 보여주는 경우엔, 그걸 진짜 데이터인 것처럼
  // 저장소/클라우드에 남기지 않습니다. (다른 기기와 동기화될 때 예시 데이터가 섞이면 안 되니까요)
  if(midlongNorm.changed && rawMidlong) await storageSet('midLongTasks', STATE.midlong);
  const normalized = normalizeTasks(tasks);
  STATE.tasks = normalized.tasks;

  // 이전 버전 버그로, 예시(더미) 데이터가 실수로 저장되어 있을 수 있어요. 정리합니다.
  const DEMO_MEETING_TITLES = new Set(DEFAULT_MEETINGS.map(m => m.title));
  const DEMO_TASK_TITLES = new Set(DEFAULT_TASKS.map(t => t.text));
  const beforeCleanCount = STATE.tasks.length;
  STATE.tasks = STATE.tasks.filter(t =>
    !(t.fromMeetingKey && DEMO_MEETING_TITLES.has(t.text)) && // 예시 회의에서 생성된 업무
    !(rawTasks && DEMO_TASK_TITLES.has(t.text) && !t.fromMeetingKey && !t.fromEventId) // 예시 업무 자체가 실제 저장소에 섞여 들어간 경우
  );
  const demoCleaned = STATE.tasks.length !== beforeCleanCount;

  // ⚠️ 실제로 동기화된 회의가 있을 때만 업무를 자동 생성합니다.
  // (예시/더미 회의 데이터가 진짜 업무처럼 저장되거나 클라우드에 올라가면 안 되니까요)
  const meetingTasksChanged = hasRealSyncedMeetings ? syncTasksFromMeetings() : false;
  const eventTasksChanged = syncPersonalEventTaskCompletion();
  if((normalized.changed && rawTasks) || meetingTasksChanged || eventTasksChanged || demoCleaned) await storageSet('personalTasks', STATE.tasks);
  STATE.leave = toLeaveMap((flexSynced && Array.isArray(flexSynced.leave)) ? flexSynced.leave : leaveFallback);
  STATE.team = (flexSynced && Array.isArray(flexSynced.team) && flexSynced.team.length) ? flexSynced.team : teamFallback;

  document.getElementById('todayLabel').textContent =
    new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  const syncParts = [];
  if(synced && synced.lastSynced) syncParts.push('회의 ' + synced.lastSynced);
  if(flexSynced && flexSynced.lastSynced) syncParts.push('연차 ' + flexSynced.lastSynced);
  if(syncParts.length){
    document.getElementById('syncStatus').textContent = syncParts.join(' · ');
    document.getElementById('syncStatus').style.color = "#4FAE8B";
  } else {
    document.getElementById('syncStatus').textContent = "예시 데이터 표시 중 (확장프로그램 미연동)";
  }

  renderMeetings();
  renderTasks();
  renderProgress();
  renderCalendar();
  renderDayDetail(STATE.selectedDate);
  renderTimeline();
  initWeather();
  renderFortune();
  renderEnglishQuote();
  renderMidLong();
  renderTeam();
}

/* ===================================================================
   회의 목록
=================================================================== */
function renderMeetings(){
  const today = todayStr();
  const list = STATE.meetings.filter(m => (!m.date || m.date === today) && !m.manual);
  const el = document.getElementById('meetingList');
  if(list.length === 0){
    el.innerHTML = '<div class="empty">오늘 예정된 회의가 없어요</div>';
    return;
  }
  el.innerHTML = list.map(m => `
    <div class="meeting-item">
      <div class="time">${m.time || ''}</div>
      <div class="title">${escapeHtml(m.title || '제목 없음')}</div>
    </div>
  `).join('');
}

/* ===================================================================
   업무 목록 + 진행률
=================================================================== */
function renderTasks(){
  const today = todayStr();
  const viewDate = STATE.taskViewDate || today;
  const isViewingToday = viewDate === today;
  const visible = getVisibleTasks();
  const html = visible.map(t => {
    const midLong = t.midLongId ? STATE.midlong.find(m=>m.id===t.midLongId) : null;
    const hasPeriod = t.dueDate && t.dueDate > t.date;
    const inPeriod = hasPeriod && viewDate >= t.date && viewDate <= t.dueDate;
    const isCarryOver = isViewingToday && t.date < today && !inPeriod;
    const isOverdue = !t.done && t.dueDate && t.dueDate < today;
    return `
    <div class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" data-id="${t.id}">
      <span class="priority-dot" style="background:${PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.medium}" title="중요도: ${PRIORITY_LABEL[t.priority] || '보통'}"></span>
      <label data-id="${t.id}">
        ${midLong ? `<span class="midlong-tag">📌 ${escapeHtml(midLong.title)}</span><br>` : ''}${escapeHtml(t.text)}${isCarryOver ? `<span class="carry-tag">(${formatMD(t.date)} 이월)</span>` : ''}${t.memo || t.link ? '<span class="memo-mark" title="메모 있음">📝</span>' : ''}${hasPeriod ? `<span class="period-tag ${isOverdue ? 'overdue' : ''}" title="완료목표일까지 계속 표시">📅${formatMD(t.date)}~${formatMD(t.dueDate)}</span>` : (t.dueDate ? `<span class="due-tag ${isOverdue ? 'overdue' : ''}">🎯${formatMD(t.dueDate)}</span>` : '')}
      </label>
      <button class="task-delete-btn" data-id="${t.id}" title="삭제" aria-label="삭제">✕</button>
    </div>
  `;
  }).join('') || '<div class="empty">등록된 업무가 없어요</div>';

  const dLabel = new Date(viewDate + 'T00:00:00');
  const dowNames = ['일','월','화','수','목','금','토'];
  const labelEl = document.getElementById('taskDayLabel');
  if(labelEl){
    labelEl.textContent = isViewingToday
      ? '오늘'
      : `${dLabel.getMonth()+1}/${dLabel.getDate()} (${dowNames[dLabel.getDay()]})`;
  }
  const jumpEl = document.getElementById('taskDateJump');
  if(jumpEl) jumpEl.value = viewDate;

  document.getElementById('taskListLeft').innerHTML = html;
  const taskListCenterEl = document.getElementById('taskListCenter');
  if(taskListCenterEl) taskListCenterEl.innerHTML = html;

  document.querySelectorAll('.task-item input[type=checkbox]').forEach(cb=>{
    const id = Number(cb.dataset.id);
    const t = STATE.tasks.find(x=>x.id===id);
    if(t) cb.checked = !!t.done;
    cb.addEventListener('click', (e)=> e.stopPropagation());
    cb.addEventListener('change', async (e)=>{
      const t2 = STATE.tasks.find(x=>x.id===id);
      if(t2){
        t2.done = e.target.checked;
        t2.completedAt = e.target.checked ? todayStr() : null;
        await storageSet('personalTasks', STATE.tasks);
        renderTasks(); renderProgress();
      }
    });
  });

  document.querySelectorAll('#taskListLeft .task-delete-btn, #taskListCenter .task-delete-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const id = Number(e.currentTarget.dataset.id);
      STATE.tasks = STATE.tasks.filter(t=>t.id!==id);
      await storageSet('personalTasks', STATE.tasks);
      renderTasks();
      renderProgress();
    });
  });

  document.querySelectorAll('.task-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      openTaskModal(Number(item.dataset.id));
    });
  });
}
// "2026-07-20" → "07/20"
function formatMD(dateStr){
  const m = dateStr && dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : dateStr;
}

/* ===================================================================
   애니메이션 꽃 (진행률에 따라 씨앗 → 새싹 → 잎 → 봉오리 → 만개)
=================================================================== */
function getSeasonFlower(){
  const month = new Date().getMonth() + 1;
  if(month===3 || month===4) return { name:'벚꽃', petalColor:'#FFB7C5', petalEdge:'#FF8FA8', petalCount:5, shape:'notch', centerColor:'#FFC94D', leafColor:'#8FBF7A' };
  if(month===5 || month===6) return { name:'장미', petalColor:'#E8546B', petalEdge:'#C23253', petalCount:8, shape:'round', centerColor:'#8E2A3C', leafColor:'#4E9B5C' };
  if(month===7 || month===8) return { name:'해바라기', petalColor:'#FFC93C', petalEdge:'#F5A623', petalCount:13, shape:'thin', centerColor:'#6B4423', leafColor:'#5FA85B' };
  if(month===9 || month===10) return { name:'코스모스', petalColor:'#F2A6D8', petalEdge:'#E081C0', petalCount:8, shape:'thin', centerColor:'#FFDD57', leafColor:'#7FBF6E' };
  if(month===11 || month===12) return { name:'동백꽃', petalColor:'#D62839', petalEdge:'#A3182A', petalCount:6, shape:'round', centerColor:'#FFD700', leafColor:'#3E7A4C' };
  return { name:'매화', petalColor:'#FFF3F5', petalEdge:'#FFB7C5', petalCount:5, shape:'round', centerColor:'#E85D75', leafColor:'#7FA86B' };
}

const FLOWER_STAGE_MSG = {
  seed:'씨앗을 심었어요',
  sprout:'새싹이 돋아났어요',
  leaf:'무럭무럭 자라는 중이에요',
  bud:'꽃봉오리가 맺혔어요',
  bloom:'활짝 폈어요! 오늘도 수고했어요 🎉'
};

function stageForPct(pct, total){
  if(total === 0) return 'seed';
  if(pct <= 0) return 'seed';
  if(pct < 34) return 'sprout';
  if(pct < 67) return 'leaf';
  if(pct < 100) return 'bud';
  return 'bloom';
}

// 귀엽고 단순한 동글동글한 꽃잎 (원형 뭉치 스타일)
function petalMarkup(cx, cy, angleDeg, shape, color, edge, scale){
  const dist = 8.5 * scale;
  const r = (shape==='thin' ? 4 : 5.4) * scale;
  const rad = (angleDeg * Math.PI) / 180;
  const px = cx + dist * Math.sin(rad);
  const py = cy - dist * Math.cos(rad);
  return `<circle cx="${px}" cy="${py}" r="${r}" fill="${color}" stroke="${edge}" stroke-width="0.6"/>`;
}
// 만개했을 때 살짝 귀여운 표정을 그려줍니다
function cuteFace(cx, cy, scale){
  const s = scale;
  return `
    <circle cx="${cx - 2.4*s}" cy="${cy - 0.5*s}" r="${0.7*s}" fill="#3A2A1E"/>
    <circle cx="${cx + 2.4*s}" cy="${cy - 0.5*s}" r="${0.7*s}" fill="#3A2A1E"/>
    <path d="M${cx-1.6*s},${cy+1.6*s} Q${cx},${cy+3*s} ${cx+1.6*s},${cy+1.6*s}" stroke="#3A2A1E" stroke-width="${0.6*s}" fill="none" stroke-linecap="round"/>
  `;
}

function buildFlowerSVG(stage, cfg){
  const soil = `<ellipse cx="50" cy="94" rx="26" ry="5" fill="#E7DCC8"/><ellipse cx="50" cy="93" rx="20" ry="3.4" fill="#D8C9AC"/>`;

  if(stage === 'seed'){
    return `<svg viewBox="0 0 100 100" class="flower-pop">
      ${soil}
      <ellipse cx="50" cy="90" rx="5" ry="3.6" fill="#8B5E34"/>
    </svg>`;
  }

  if(stage === 'sprout'){
    return `<svg viewBox="0 0 100 100" class="flower-pop">
      ${soil}
      <g class="stem-sway">
        <path d="M50,93 C50,80 50,78 50,72" stroke="${cfg.leafColor}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M50,80 C44,78 40,74 40,70 C46,71 50,74 50,80 Z" fill="${cfg.leafColor}"/>
        <path d="M50,76 C56,74 60,70 60,66 C54,67 50,70 50,76 Z" fill="${cfg.leafColor}"/>
      </g>
    </svg>`;
  }

  if(stage === 'leaf'){
    return `<svg viewBox="0 0 100 100" class="flower-pop">
      ${soil}
      <g class="stem-sway">
        <path d="M50,93 C50,70 50,65 50,52" stroke="${cfg.leafColor}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
        <path d="M50,84 C42,81 36,75 36,69 C44,71 50,76 50,84 Z" fill="${cfg.leafColor}"/>
        <path d="M50,78 C58,75 64,69 64,63 C56,65 50,70 50,78 Z" fill="${cfg.leafColor}"/>
        <path d="M50,66 C43,63 38,58 38,53 C45,55 50,59 50,66 Z" fill="${cfg.leafColor}"/>
        <circle cx="50" cy="50" r="4.5" fill="${cfg.petalEdge}"/>
      </g>
    </svg>`;
  }

  if(stage === 'bud'){
    let petals = '';
    const n = Math.max(6, Math.round(cfg.petalCount * 0.55));
    for(let i=0;i<n;i++){
      petals += petalMarkup(50, 34, (360/n)*i, cfg.shape, cfg.petalColor, cfg.petalEdge, 0.55);
    }
    return `<svg viewBox="0 0 100 100" class="flower-pop">
      ${soil}
      <g class="stem-sway">
        <path d="M50,93 C50,68 50,58 50,40" stroke="${cfg.leafColor}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
        <path d="M50,80 C41,77 35,71 35,64 C44,66 50,72 50,80 Z" fill="${cfg.leafColor}"/>
        <path d="M50,72 C59,69 65,63 65,56 C56,58 50,63 50,72 Z" fill="${cfg.leafColor}"/>
        ${petals}
        <circle cx="50" cy="34" r="6.5" fill="${cfg.centerColor}"/>
      </g>
    </svg>`;
  }

  // 100% 만개: 줄기 없이 큰 꽃송이 하나만, 폭죽처럼 팡 터지는 연출
  let petals = '';
  for(let i=0;i<cfg.petalCount;i++){
    petals += petalMarkup(50, 50, (360/cfg.petalCount)*i, cfg.shape, cfg.petalColor, cfg.petalEdge, 1.9);
  }
  const confetti = buildConfetti();
  return `<svg viewBox="0 0 100 100" class="flower-pop">
    ${confetti}
    <g>
      ${petals}
      <circle cx="50" cy="50" r="16" fill="${cfg.centerColor}"/>
      ${cuteFace(50, 50, 1.9)}
    </g>
  </svg>`;
}

// 100% 달성 순간 팡 터지는 폭죽/색종이 효과
function buildConfetti(){
  const colors = ['#FFC93C','#FF8FA3','#8C93E8','#4FAE8B','#FFAFCC','#FFE199'];
  const shapes = [];
  const n = 14;
  for(let i=0;i<n;i++){
    const angle = (360/n)*i + (i%2===0 ? 4 : -4);
    const rad = (angle*Math.PI)/180;
    const dist = 20 + (i%3)*5;
    const x = 50 + dist*Math.sin(rad);
    const y = 50 - dist*Math.cos(rad);
    const color = colors[i % colors.length];
    const dur = 1.6 + (i%4)*0.35;
    const delay = (i%6)*0.15;
    const driftX = 4 + (i%3)*2;
    const driftY = 5 + (i%4)*2;
    const isRect = i % 2 === 0;
    const style = `animation-duration:${dur}s; animation-delay:${delay}s; --dx:${driftX}px; --dy:${driftY}px;`;
    if(isRect){
      shapes.push(`<rect class="confetti-piece" x="${x-2.2}" y="${y-2.2}" width="4.4" height="4.4" fill="${color}" style="${style}"/>`);
    } else {
      shapes.push(`<circle class="confetti-piece" cx="${x}" cy="${y}" r="2.6" fill="${color}" style="${style}"/>`);
    }
  }
  return shapes.join('');
}

// 캘린더 도장용: 줄기 없이 꽃송이(또는 봉오리)만 작게 그립니다
function buildFlowerHeadIcon(stage, cfg){
  const isBud = stage === 'bud';
  const n = isBud ? Math.max(6, Math.round(cfg.petalCount*0.55)) : cfg.petalCount;
  const petalScale = isBud ? 0.85 : 1.15;
  const centerR = isBud ? 5 : 7;
  let petals = '';
  for(let i=0;i<n;i++){
    petals += petalMarkup(20, 20, (360/n)*i, cfg.shape, cfg.petalColor, cfg.petalEdge, petalScale);
  }
  const face = isBud ? '' : cuteFace(20, 20, 0.85);
  return `<svg viewBox="0 0 40 40" style="width:100%; height:100%;">
    ${petals}
    <circle cx="20" cy="20" r="${centerR}" fill="${cfg.centerColor}"/>
    ${face}
  </svg>`;
}

let lastFlowerStage = null;
function renderFlower(pct, total){
  const stage = stageForPct(pct, total);
  const box = document.getElementById('flowerBox');
  const nameEl = document.getElementById('flowerName');
  const msgEl = document.getElementById('flowerMsg');
  if(stage !== lastFlowerStage){
    const cfg = getSeasonFlower();
    box.innerHTML = buildFlowerSVG(stage, cfg);
    nameEl.textContent = cfg.name;
    msgEl.textContent = FLOWER_STAGE_MSG[stage];
    lastFlowerStage = stage;
  }
}

function renderProgress(){
  const visible = getTodayTasksForProgress();
  const total = visible.length;
  const done = visible.filter(t=>t.done).length;
  const pct = total ? Math.round(done/total*100) : 0;
  document.getElementById('progressPct').textContent = pct + '%';
  document.getElementById('progressSub').textContent = `완료 ${done} / 전체 ${total}`;
  document.getElementById('pbCompletedNum').textContent = done;
  document.getElementById('pbTotalNum').textContent = total;
  renderFlower(pct, total);
  requestAnimationFrame(()=>{
    document.getElementById('donutFill').style.strokeDasharray = `${pct} 100`;
  });
}

document.getElementById('addTaskBtn').addEventListener('click', addTask);

document.getElementById('taskPrevDay').addEventListener('click', ()=>{
  const d = new Date((STATE.taskViewDate || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  STATE.taskViewDate = dateToStr(d);
  renderTasks();
  renderProgress();
});
document.getElementById('taskNextDay').addEventListener('click', ()=>{
  const d = new Date((STATE.taskViewDate || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  STATE.taskViewDate = dateToStr(d);
  renderTasks();
  renderProgress();
});
document.getElementById('taskDateJump').addEventListener('change', (e)=>{
  if(!e.target.value) return;
  STATE.taskViewDate = e.target.value;
  renderTasks();
  renderProgress();
});
document.getElementById('taskTodayBtn').addEventListener('click', ()=>{
  STATE.taskViewDate = todayStr();
  renderTasks();
  renderProgress();
});
document.getElementById('newTaskInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') addTask();
});
async function addTask(){
  const input = document.getElementById('newTaskInput');
  const prioritySelect = document.getElementById('newTaskPriority');
  const dueDateInput = document.getElementById('newTaskDueDate');
  const text = input.value.trim();
  if(!text) return;
  const nextId = STATE.tasks.length ? Math.max(...STATE.tasks.map(t=>t.id))+1 : 1;
  const taskDate = STATE.taskViewDate || todayStr();
  STATE.tasks.push({
    id: nextId,
    text,
    done: false,
    date: taskDate,
    priority: (prioritySelect && prioritySelect.value) || 'medium',
    memo: '',
    link: '',
    completedAt: null,
    dueDate: (dueDateInput && dueDateInput.value) || null
  });
  await storageSet('personalTasks', STATE.tasks);
  input.value = '';
  if(dueDateInput) dueDateInput.value = '';
  renderTasks();
  renderProgress();
}

/* ===================================================================
   업무 상세 모달 (메모 / 링크 / 중요도)
=================================================================== */
let currentModalTaskId = null;

function populateMidLongSelect(selectedId){
  const sel = document.getElementById('taskModalMidLong');
  const options = ['<option value="">일반 업무 (선택 안 함)</option>']
    .concat(STATE.midlong.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`));
  sel.innerHTML = options.join('');
  sel.value = selectedId ? String(selectedId) : '';
}

function openTaskModal(id){
  const t = STATE.tasks.find(x=>x.id===id);
  if(!t) return;
  currentModalTaskId = id;
  document.getElementById('taskModalTitleInput').value = t.text || '';
  populateMidLongSelect(t.midLongId);
  document.getElementById('taskModalPriority').value = t.priority || 'medium';
  document.getElementById('taskModalDueDate').value = t.dueDate || '';
  document.getElementById('taskModalMemo').value = t.memo || '';
  document.getElementById('taskModalLink').value = t.link || '';
  updateTaskModalLinkPreview(t.link || '');
  document.getElementById('taskModalOverlay').style.display = 'flex';
}
function closeTaskModal(){
  document.getElementById('taskModalOverlay').style.display = 'none';
  currentModalTaskId = null;
}
async function saveTaskModal(){
  const t = STATE.tasks.find(x=>x.id===currentModalTaskId);
  if(!t) return;
  const newText = document.getElementById('taskModalTitleInput').value.trim();
  if(newText) t.text = newText;
  const midLongVal = document.getElementById('taskModalMidLong').value;
  t.midLongId = midLongVal ? Number(midLongVal) : null;
  t.priority = document.getElementById('taskModalPriority').value;
  t.dueDate = document.getElementById('taskModalDueDate').value || null;
  t.memo = document.getElementById('taskModalMemo').value;
  t.link = document.getElementById('taskModalLink').value.trim();
  await storageSet('personalTasks', STATE.tasks);
  closeTaskModal();
  renderTasks();
  renderProgress();
  renderMidLong();
}
function updateTaskModalLinkPreview(link){
  const el = document.getElementById('taskModalLinkPreview');
  if(link){
    el.innerHTML = `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(link)}</a>`;
  } else {
    el.innerHTML = '';
  }
}

document.getElementById('taskModalClose').addEventListener('click', closeTaskModal);
document.getElementById('taskModalCancel').addEventListener('click', closeTaskModal);
document.getElementById('taskModalSave').addEventListener('click', saveTaskModal);
document.getElementById('taskModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'taskModalOverlay') closeTaskModal();
});
document.getElementById('taskModalLink').addEventListener('input', (e)=>{
  updateTaskModalLinkPreview(e.target.value.trim());
});
document.getElementById('taskModalDelete').addEventListener('click', async ()=>{
  if(currentModalTaskId == null) return;
  STATE.tasks = STATE.tasks.filter(t=>t.id!==currentModalTaskId);
  await storageSet('personalTasks', STATE.tasks);
  closeTaskModal();
  renderTasks();
  renderProgress();
});

/* ===================================================================
   전체 업무 이력 → 새 페이지(history.html)로 열기
=================================================================== */
document.querySelectorAll('.task-history-trigger').forEach(el=>{
  el.addEventListener('click', ()=>{
    const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('history.html')
      : 'history.html';
    window.open(url, '_blank');
  });
});

/* ===================================================================
   캘린더
=================================================================== */
document.getElementById('prevMonth').addEventListener('click', ()=>{
  STATE.calDate.setMonth(STATE.calDate.getMonth()-1);
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', ()=>{
  STATE.calDate.setMonth(STATE.calDate.getMonth()+1);
  renderCalendar();
});
document.getElementById('thisMonthBtn').addEventListener('click', ()=>{
  STATE.calDate = new Date();
  renderCalendar();
});

// 기간(여러 날) 일정 띠를 실제 렌더링된 날짜 셀의 위치를 기준으로 겹쳐 그립니다.
// (그리드 배치 자체를 건드리지 않아서 날짜 위치가 절대 밀리지 않아요)
function renderEventBars(year, month, daysInMonth, startWeekday){
  const grid = document.getElementById('calGrid');
  grid.querySelectorAll('.cal-event-bar').forEach(el => el.remove());

  const multiDay = STATE.personalEvents.filter(ev => ev.startDate !== ev.endDate);
  if(multiDay.length === 0) return;

  const gridRect = grid.getBoundingClientRect();
  const BAR_HEIGHT = 13, BAR_GAP = 2;

  // 주(row)별로, 겹치는 구간끼리만 다른 레인(줄)에 쌓이도록 배정합니다.
  const rowLanes = {}; // rowIdx -> [ [{colStart,colEnd}], [{colStart,colEnd}], ... ]
  function assignLane(rowIdx, colStart, colEnd){
    if(!rowLanes[rowIdx]) rowLanes[rowIdx] = [];
    const lanes = rowLanes[rowIdx];
    for(let i=0;i<lanes.length;i++){
      const overlaps = lanes[i].some(seg => !(colEnd < seg.colStart || colStart > seg.colEnd));
      if(!overlaps){ lanes[i].push({colStart, colEnd}); return i; }
    }
    lanes.push([{colStart, colEnd}]);
    return lanes.length - 1;
  }

  multiDay.forEach(ev=>{
    // 이번 달에 걸쳐 보이는 구간을, 주(週) 경계에서 끊어 세그먼트로 나눕니다.
    let segStartDay = null;
    for(let day=1; day<=daysInMonth+1; day++){
      const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day,daysInMonth)).padStart(2,'0')}`;
      const within = day<=daysInMonth && dStr >= ev.startDate && dStr <= ev.endDate;
      const pos = startWeekday + (day-1);
      if(within && segStartDay === null) segStartDay = day;
      const endsHere = segStartDay !== null && (!within || (pos % 7) === 6);
      if(endsHere){
        const segEndDay = within ? day : day - 1;
        const segStartPos = startWeekday + (segStartDay - 1);
        const segEndPos = startWeekday + (segEndDay - 1);
        const rowIdx = Math.floor(segStartPos/7);
        const colStart = (segStartPos % 7) + 1;
        const colEnd = (segEndPos % 7) + 1;
        const lane = assignLane(rowIdx, colStart, colEnd);

        const startDateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(segStartDay).padStart(2,'0')}`;
        const endDateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(segEndDay).padStart(2,'0')}`;
        const startCell = grid.querySelector(`.cal-cell[data-date="${startDateStr}"]`);
        const endCell = grid.querySelector(`.cal-cell[data-date="${endDateStr}"]`);
        if(startCell && endCell){
          const sRect = startCell.getBoundingClientRect();
          const eRect = endCell.getBoundingClientRect();
          const bar = document.createElement('div');
          bar.className = 'cal-event-bar';
          if(startDateStr === ev.startDate) bar.classList.add('bar-start');
          if(endDateStr === ev.endDate) bar.classList.add('bar-end');
          bar.title = `${ev.title} (${formatMD(ev.startDate)}~${formatMD(ev.endDate)})`;
          bar.textContent = ev.title;
          bar.style.position = 'absolute';
          bar.style.height = BAR_HEIGHT + 'px';
          bar.style.lineHeight = BAR_HEIGHT + 'px';
          bar.style.left = (sRect.left - gridRect.left) + 'px';
          bar.style.top = (sRect.top - gridRect.top + sRect.height - (BAR_HEIGHT+BAR_GAP)*(lane+1)) + 'px';
          bar.style.width = (eRect.right - sRect.left) + 'px';
          bar.style.cursor = 'pointer';
          bar.style.pointerEvents = 'auto';
          bar.addEventListener('click', (e)=>{
            e.stopPropagation();
            openEventModal(ev.startDate, ev.id);
          });
          grid.appendChild(bar);
        }
        segStartDay = null; // 다음 줄로 넘어가도, 실제로 범위 안인지는 다음 반복에서 새로 확인합니다.
      }
    }
  });
}

function renderCalendar(){
  const d = STATE.calDate;
  const year = d.getFullYear(), month = d.getMonth();
  document.getElementById('calYm').textContent = `${year}년 ${month+1}월`;

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // 날짜별 회의 목록을 미리 묶어둡니다.
  const meetingsByDate = {};
  STATE.meetings.forEach(m=>{
    if(!m.date) return;
    if(!meetingsByDate[m.date]) meetingsByDate[m.date] = [];
    meetingsByDate[m.date].push(m);
  });
  const leaveMap = STATE.leave; // { "2026-07-20": "종일" 또는 "08:30~12:30" }
  const todayS = todayStr();

  // 날짜별 업무 완료 현황을 미리 묶어서, 그날의 성장 단계를 계산합니다.
  const tasksByDate = {};
  STATE.tasks.forEach(t=>{
    if(!t.date) return;
    if(!tasksByDate[t.date]) tasksByDate[t.date] = [];
    tasksByDate[t.date].push(t);
  });
  const STAGE_EMOJI = { seed:'🌰', sprout:'🌱', leaf:'🌿' };
  const seasonCfg = getSeasonFlower();

  // 기간(여러 날)에 걸친 직접 추가 일정은 날짜별 뱃지 대신, 이어진 띠로 따로 표시합니다.
  const multiDayEventIds = new Set(
    STATE.personalEvents.filter(ev => ev.startDate !== ev.endDate).map(ev => ev.id)
  );

  let cells = '';
  const dowNames = ['일','월','화','수','목','금','토'];
  dowNames.forEach(n=> cells += `<div class="dow">${n}</div>`);

  for(let i=startWeekday-1;i>=0;i--){
    cells += `<div class="cal-cell other"><span class="daynum">${daysInPrevMonth-i}</span></div>`;
  }
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === todayS;
    const isSelected = dateStr === STATE.selectedDate;
    const holidayName = KR_HOLIDAYS_2026[dateStr];
    const dayMeetings = (meetingsByDate[dateStr] || [])
      .filter(m => !(m.manual && multiDayEventIds.has(m.eventId))) // 기간 일정은 띠로 따로 표시하니 여기선 제외
      .slice()
      .sort((a,b)=> (a.time||'').localeCompare(b.time||''));

    let inner = `<span class="daynum">${day}</span>`;
    const dayTasks = tasksByDate[dateStr] || [];
    // 오늘 하루치 도장은 실시간으로 계속 자라는 대신, 퇴근시간(오후 5시반)이
    // 지나야 "하루 마무리" 도장으로 찍히게 합니다. 지난 날짜는 항상 그대로 표시.
    const now = new Date();
    const isDayWrappedUp = dateStr < todayS || (now.getHours() > 17 || (now.getHours() === 17 && now.getMinutes() >= 30));
    if(dateStr <= todayS && dayTasks.length && isDayWrappedUp){
      const doneCnt = dayTasks.filter(t=>t.done).length;
      const dayPct = Math.round(doneCnt/dayTasks.length*100);
      const dayStage = stageForPct(dayPct, dayTasks.length);
      const stampContent = (dayStage === 'bud' || dayStage === 'bloom')
        ? buildFlowerHeadIcon(dayStage, seasonCfg)
        : STAGE_EMOJI[dayStage];
      inner += `<span class="day-stamp" title="${doneCnt}/${dayTasks.length} 완료">${stampContent}</span>`;
    }
    if(holidayName){
      inner += `<span class="holiday-label">${escapeHtml(holidayName)}</span>`;
    }
    if(leaveMap[dateStr]){
      inner += `<span class="holiday-label" style="color:var(--peach-deep)">연차 ${escapeHtml(leaveMap[dateStr])}</span>`;
    }
    const MAX_SHOW = 5;
    dayMeetings.slice(0, MAX_SHOW).forEach(m=>{
      const startTime = (m.time||'').split('-')[0] || '';
      inner += `<span class="mini-event ${m.manual ? 'manual' : ''}" ${m.manual ? `data-event-id="${m.eventId}"` : ''}>${startTime ? startTime+' ' : ''}${escapeHtml(m.title||'')}</span>`;
    });
    if(dayMeetings.length > MAX_SHOW){
      inner += `<span class="mini-more">+${dayMeetings.length - MAX_SHOW}건 더</span>`;
    }

    cells += `<div class="cal-cell ${isToday?'today':''} ${isSelected?'selected':''} ${holidayName?'holiday':''}" data-date="${dateStr}">${inner}</div>`;
  }
  const totalCells = startWeekday + daysInMonth;
  const remain = (7 - (totalCells % 7)) % 7;
  for(let i=1;i<=remain;i++){
    cells += `<div class="cal-cell other"><span class="daynum">${i}</span></div>`;
  }
  document.getElementById('calGrid').innerHTML = cells;

  // 기간(여러 날) 일정 띠는 날짜 셀이 다 그려진 뒤, 실제 셀 위치를 기준으로
  // 겹쳐서 그립니다 (달력 그리드 배치 자체에는 영향을 주지 않아요).
  renderEventBars(year, month, daysInMonth, startWeekday);

  document.querySelectorAll('.cal-cell[data-date]').forEach(cell=>{
    cell.addEventListener('click', ()=>{
      STATE.selectedDate = cell.dataset.date;
      renderCalendar();
      renderDayDetail(STATE.selectedDate);
      openEventModal(STATE.selectedDate, null);
    });
  });
  document.querySelectorAll('.mini-event.manual').forEach(chip=>{
    chip.addEventListener('click', (e)=>{
      e.stopPropagation();
      const cell = chip.closest('.cal-cell[data-date]');
      if(cell) openEventModal(cell.dataset.date, chip.dataset.eventId);
    });
  });
}

/* ===================================================================
   선택한 날짜 상세 (회의명 + 시간 + 참석자/회의실, 공휴일 표기)
=================================================================== */
function renderDayDetail(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  const dowNames = ['일','월','화','수','목','금','토'];
  const label = `${d.getMonth()+1}월 ${d.getDate()}일 (${dowNames[d.getDay()]}) 상세`;
  document.getElementById('dayDetailTitle').textContent = label;

  const holidayName = KR_HOLIDAYS_2026[dateStr];
  const leaveTime = STATE.leave[dateStr];
  const multiDayIds = new Set(
    STATE.personalEvents.filter(ev => ev.startDate !== ev.endDate).map(ev => ev.id)
  );
  const dayMeetings = STATE.meetings
    .filter(m => m.date === dateStr)
    .sort((a,b)=>{
      const aIsPeriod = a.manual && multiDayIds.has(a.eventId);
      const bIsPeriod = b.manual && multiDayIds.has(b.eventId);
      if(aIsPeriod !== bIsPeriod) return aIsPeriod ? -1 : 1; // 기간 일정이 항상 위
      return (a.time||'').localeCompare(b.time||''); // 나머지는 시간순
    });

  let html = '';
  if(holidayName){
    html += `<span class="day-detail-holiday">🎌 공휴일 · ${escapeHtml(holidayName)}</span><br>`;
  }
  if(leaveTime){
    html += `<span class="day-detail-holiday" style="color:var(--peach-deep); background:#FFF3E5;">🌴 연차 · ${escapeHtml(leaveTime)}</span><br>`;
  }

  if(dayMeetings.length === 0){
    html += '<div class="empty">이 날짜엔 등록된 회의가 없어요</div>';
  } else {
    html += dayMeetings.map(m=>{
      const rows = [];
      if(m.manual){
        const ev = STATE.personalEvents.find(e => String(e.id) === String(m.eventId));
        if(ev && ev.startDate !== ev.endDate){
          rows.push(`📅 ${formatMD(ev.startDate)} ~ ${formatMD(ev.endDate)}`);
        }
      }
      if(m.time) rows.push(`🕐 ${m.time}`);
      if(m.rooms) rows.push(`📍 ${escapeHtml(m.rooms)}`);
      if(m.attendees) rows.push(`👥 ${escapeHtml(m.attendees)}`);
      if(m.manual && m.memo) rows.push(`📝 ${escapeHtml(m.memo)}`);
      return `
        <div class="day-detail-item ${m.manual ? 'manual-event' : ''}" ${m.manual ? `data-event-id="${m.eventId}"` : ''}>
          <div class="t">${m.manual ? '<span class="manual-tag">내 일정</span> ' : ''}${escapeHtml(m.title || '제목 없음')}</div>
          ${rows.map(r=>`<div class="row">${r}</div>`).join('')}
        </div>
      `;
    }).join('');
  }

  document.getElementById('dayDetailBody').innerHTML = html;

  document.querySelectorAll('.day-detail-item.manual-event').forEach(item=>{
    item.addEventListener('click', ()=>{
      openEventModal(dateStr, item.dataset.eventId);
    });
  });
}

/* ===================================================================
   일정 추가/수정 모달
=================================================================== */
function timeOptionsHtml(selected){
  let opts = '';
  for(let h=0; h<24; h++){
    for(let m=0; m<60; m+=30){
      const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      opts += `<option value="${val}" ${val===selected?'selected':''}>${val}</option>`;
    }
  }
  return opts;
}

let currentEventModalDate = null;
let currentEventModalId = null;

function openEventModal(dateStr, eventId){
  currentEventModalDate = dateStr;
  currentEventModalId = eventId || null;

  document.getElementById('eventModalStartTime').innerHTML = timeOptionsHtml('09:00');
  document.getElementById('eventModalEndTime').innerHTML = timeOptionsHtml('10:00');

  if(eventId){
    const ev = STATE.personalEvents.find(e => String(e.id) === String(eventId));
    if(!ev) return;
    document.getElementById('eventModalHeading').textContent = '일정 수정';
    document.getElementById('eventModalTitleInput').value = ev.title || '';
    document.getElementById('eventModalStartDate').value = ev.startDate || dateStr;
    document.getElementById('eventModalEndDate').value = (ev.endDate && ev.endDate !== ev.startDate) ? ev.endDate : '';
    document.getElementById('eventModalStartTime').value = ev.startTime || '09:00';
    document.getElementById('eventModalEndTime').value = ev.endTime || '10:00';
    document.getElementById('eventModalMemo').value = ev.memo || '';
    document.getElementById('eventModalDelete').style.display = 'inline-block';
  } else {
    document.getElementById('eventModalHeading').textContent = '일정 추가';
    document.getElementById('eventModalTitleInput').value = '';
    document.getElementById('eventModalStartDate').value = dateStr;
    document.getElementById('eventModalEndDate').value = '';
    document.getElementById('eventModalStartTime').value = '09:00';
    document.getElementById('eventModalEndTime').value = '10:00';
    document.getElementById('eventModalMemo').value = '';
    document.getElementById('eventModalDelete').style.display = 'none';
  }
  document.getElementById('eventModalOverlay').style.display = 'flex';
}
function closeEventModal(){
  document.getElementById('eventModalOverlay').style.display = 'none';
  currentEventModalDate = null;
  currentEventModalId = null;
}

// 이 일정에서 자동 생성된 '오늘의 업무' 항목들을 정리하고 다시 만듭니다.
function syncTasksForEvent(ev){
  STATE.tasks = STATE.tasks.filter(t => t.fromEventId !== ev.id);
  const start = new Date(ev.startDate+'T00:00:00');
  const end = new Date((ev.endDate || ev.startDate)+'T00:00:00');
  let cur = new Date(start);
  let guard = 0;
  const nextId = () => (STATE.tasks.length ? Math.max(...STATE.tasks.map(t=>t.id)) + 1 : 1);
  while(cur <= end && guard < 366){
    STATE.tasks.push({
      id: nextId(),
      text: ev.title,
      done: false,
      date: dateToStr(cur),
      priority: 'medium',
      memo: ev.memo || '',
      link: '',
      completedAt: null,
      dueDate: null,
      midLongId: null,
      fromEventId: ev.id
    });
    cur.setDate(cur.getDate()+1);
    guard++;
  }
}

// 내 일정(직접 추가한 일정)에서 자동 생성된 '오늘의 업무'도, 그 일정에 시간이
// 지정되어 있고 종료 시간이 지나면 자동으로 완료 체크합니다.
function syncPersonalEventTaskCompletion(){
  const todayS = todayStr();
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();
  let changed = false;
  STATE.tasks.forEach(t=>{
    if(!t.fromEventId || t.done) return;
    const ev = STATE.personalEvents.find(e => String(e.id) === String(t.fromEventId));
    if(!ev || !ev.endTime) return; // 시간이 지정 안 된 일정(하루종일)은 자동 완료하지 않음
    const endMin = timeToMinutes(ev.endTime);
    const isPast = t.date < todayS || (t.date === todayS && endMin !== null && nowMin >= endMin);
    if(isPast){
      t.done = true;
      t.completedAt = t.date;
      changed = true;
    }
  });
  return changed;
}


async function saveEventModal(){
  const title = document.getElementById('eventModalTitleInput').value.trim();
  const startDate = document.getElementById('eventModalStartDate').value;
  let endDate = document.getElementById('eventModalEndDate').value;
  const startTime = document.getElementById('eventModalStartTime').value;
  const endTime = document.getElementById('eventModalEndTime').value;
  const memo = document.getElementById('eventModalMemo').value;

  if(!title){ alert('일정 제목을 입력해주세요.'); return; }
  if(!startDate){ alert('시작일을 선택해주세요.'); return; }
  if(endDate && endDate < startDate){ alert('종료일은 시작일보다 빠를 수 없어요.'); return; }
  if(!endDate) endDate = startDate; // 기간을 선택 안 하면 당일만

  const id = currentEventModalId || `ev${Date.now()}`;
  const ev = { id, title, startDate, endDate, startTime, endTime, memo };

  const idx = STATE.personalEvents.findIndex(e => String(e.id) === String(id));
  if(idx >= 0) STATE.personalEvents[idx] = ev;
  else STATE.personalEvents.push(ev);

  syncTasksForEvent(ev);
  syncPersonalEventTaskCompletion();
  recomputeMeetings();

  await storageSet('personalEvents', STATE.personalEvents);
  await storageSet('personalTasks', STATE.tasks);

  closeEventModal();
  renderMeetings();
  renderCalendar();
  renderDayDetail(STATE.selectedDate);
  renderTimeline();
  renderTasks();
  renderProgress();
  renderMidLong();
}

async function deleteEventModal(){
  if(!currentEventModalId) return;
  STATE.personalEvents = STATE.personalEvents.filter(e => String(e.id) !== String(currentEventModalId));
  STATE.tasks = STATE.tasks.filter(t => t.fromEventId !== currentEventModalId);
  recomputeMeetings();
  await storageSet('personalEvents', STATE.personalEvents);
  await storageSet('personalTasks', STATE.tasks);
  closeEventModal();
  renderMeetings();
  renderCalendar();
  renderDayDetail(STATE.selectedDate);
  renderTimeline();
  renderTasks();
  renderProgress();
  renderMidLong();
}

document.getElementById('eventModalClose').addEventListener('click', closeEventModal);
document.getElementById('eventModalCancel').addEventListener('click', closeEventModal);
document.getElementById('eventModalSave').addEventListener('click', saveEventModal);
document.getElementById('eventModalDelete').addEventListener('click', deleteEventModal);
document.getElementById('eventModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'eventModalOverlay') closeEventModal();
});

/* ===================================================================
   타임라인 (09:00 ~ 18:00)
=================================================================== */
function renderTimeline(){
  const startHour = 7, endHour = 23;
  const el = document.getElementById('timeline');
  let html = '';
  for(let h=startHour; h<=endHour; h++){
    html += `<div class="tl-hour"><span class="label">${String(h).padStart(2,'0')}:00</span></div>`;
  }
  el.innerHTML = html;

  const today = todayStr();
  const todaysMeetings = STATE.meetings.filter(m => (!m.date || m.date === today) && m.time && m.time.includes('-'));

  const hourHeight = 52;
  todaysMeetings.forEach(m=>{
    const [startStr, endStr] = m.time.split('-').map(s=>s.trim());
    const startMin = timeToMinutes(startStr), endMin = timeToMinutes(endStr);
    if(startMin === null || endMin === null) return;
    const dayStartMin = startHour*60;
    const top = ((startMin - dayStartMin)/60)*hourHeight;
    const height = Math.max(((endMin-startMin)/60)*hourHeight, 20);
    const div = document.createElement('div');
    div.className = 'tl-event' + (m.manual ? ' manual' : '');
    div.style.top = top + 'px';
    div.style.height = height + 'px';
    if(m.manual){
      div.innerHTML = `<div class="tl-event-title">${escapeHtml(m.title)}</div>`;
    } else {
      const sub = [m.time, m.rooms].filter(Boolean).join(' · ');
      div.innerHTML = `<div class="tl-event-title">${escapeHtml(m.title)}</div>${sub ? `<div class="tl-event-sub">${escapeHtml(sub)}</div>` : ''}`;
    }
    el.appendChild(div);
  });

  const now = new Date();
  const nowMin = now.getHours()*60+now.getMinutes();
  if(nowMin >= startHour*60 && nowMin <= endHour*60){
    const top = ((nowMin-startHour*60)/60)*hourHeight;
    const line = document.createElement('div');
    line.className = 'tl-now';
    line.style.top = top+'px';
    el.appendChild(line);
  }
}
function timeToMinutes(str){
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if(!m) return null;
  return Number(m[1])*60+Number(m[2]);
}

/* ===================================================================
   날씨 (브라우저 위치 + Open-Meteo API로 실제 날씨를 가져옵니다 — API 키 불필요)
=================================================================== */
let cachedWeather = null;

// WMO 날씨 코드를 이모지+설명으로 변환
function weatherCodeToInfo(code){
  if(code === 0) return { emoji:'☀️', desc:'맑음' };
  if(code === 1) return { emoji:'🌤️', desc:'대체로 맑음' };
  if(code === 2) return { emoji:'⛅', desc:'구름 조금' };
  if(code === 3) return { emoji:'☁️', desc:'흐림' };
  if(code === 45 || code === 48) return { emoji:'🌫️', desc:'안개' };
  if([51,53,55,56,57].includes(code)) return { emoji:'🌦️', desc:'이슬비' };
  if([61,63,65,66,67].includes(code)) return { emoji:'🌧️', desc:'비' };
  if([71,73,75,77].includes(code)) return { emoji:'🌨️', desc:'눈' };
  if([80,81,82].includes(code)) return { emoji:'🌦️', desc:'소나기' };
  if([85,86].includes(code)) return { emoji:'🌨️', desc:'소나기 눈' };
  if([95,96,99].includes(code)) return { emoji:'⛈️', desc:'천둥번개' };
  return { emoji:'🌡️', desc:'' };
}

async function initWeather(){
  // 30분 이내에 이미 받아온 값이 있으면 재사용 (위치 권한 창을 매번 새로 안 띄우려고요)
  const cached = await storageGet('weatherCache', null);
  if(cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < 30*60*1000){
    cachedWeather = cached;
    renderWeather();
    return;
  }
  renderWeather(); // "위치 확인 중..." 표시

  if(!navigator.geolocation){
    document.getElementById('weatherHint').textContent = '이 브라우저는 위치 확인을 지원하지 않아요.';
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos)=>{
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    try{
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
      const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`;

      const weatherRes = await fetch(weatherUrl);
      const weatherData = await weatherRes.json();

      let cityName = '';
      try{
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();
        cityName = geoData.city || geoData.locality || geoData.principalSubdivision || '';
      }catch(geoErr){ /* 지역명은 실패해도 날씨 자체는 보여줍니다 */ }

      cachedWeather = {
        temp: Math.round(weatherData.current.temperature_2m),
        code: weatherData.current.weather_code,
        max: Math.round(weatherData.daily.temperature_2m_max[0]),
        min: Math.round(weatherData.daily.temperature_2m_min[0]),
        city: cityName,
        fetchedAt: Date.now()
      };
      await storageSet('weatherCache', cachedWeather);
    }catch(err){
      console.warn('[날씨] 불러오기 실패:', err.message);
      document.getElementById('weatherHint').textContent = '날씨를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
    }
    renderWeather();
  }, (err)=>{
    console.warn('[날씨] 위치 권한 거부/실패:', err.message);
    document.getElementById('weatherHint').textContent = '위치 권한을 허용하면 내 위치의 실제 날씨를 볼 수 있어요.';
    renderWeather();
  }, { timeout: 8000, maximumAge: 10*60*1000 });
}

function renderWeather(){
  const el = document.getElementById('weatherBox');
  const hintEl = document.getElementById('weatherHint');

  if(!cachedWeather){
    el.innerHTML = `
      <div class="emoji">📍</div>
      <div>
        <div class="temp">--°C</div>
        <div class="desc">위치 확인 중...</div>
      </div>
    `;
    return;
  }

  const info = weatherCodeToInfo(cachedWeather.code);
  el.innerHTML = `
    <div class="emoji">${info.emoji}</div>
    <div>
      <div class="temp">${cachedWeather.temp}°C</div>
      <div class="desc">${info.desc}${info.desc ? ' · ' : ''}최고 ${cachedWeather.max}° / 최저 ${cachedWeather.min}°</div>
    </div>
  `;
  const updatedTime = new Date(cachedWeather.fetchedAt).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
  hintEl.textContent = `${cachedWeather.city ? cachedWeather.city + ' · ' : ''}${updatedTime} 기준`;
}

/* ===================================================================
   운세 & 영어 한마디 (생일/성별 기반 개인화, 날짜 지정 확인 가능)
=================================================================== */
// 사용자 프로필 (직접 알려주신 정보를 기본값으로 사용해요)
const DEFAULT_PROFILE = { gender: 'female', birthdate: '1992-01-02' };

const FORTUNES = [
  "오늘은 미뤄뒀던 일을 시작하기 좋은 날입니다. 작은 실천이 큰 변화를 만들어요.",
  "생각지 못한 곳에서 좋은 소식이 들려올 수 있어요. 마음을 열어두세요.",
  "차분하게 하나씩 처리하면 오늘 계획한 일을 무리 없이 끝낼 수 있어요.",
  "동료와의 협업에서 좋은 아이디어가 나올 수 있는 날입니다.",
  "잠깐의 휴식이 오히려 능률을 높여줄 거예요. 스트레칭 한 번 어떠세요?",
  "평소보다 직감이 잘 맞는 날이에요. 마음이 끌리는 선택을 믿어보세요.",
  "정리정돈을 하면 마음까지 개운해지는 하루예요.",
  "예상치 못한 칭찬이나 인정을 받을 수 있어요.",
  "무리한 약속보다는 여유 있는 하루 계획이 잘 맞아요.",
  "새로운 사람과의 대화에서 좋은 힌트를 얻을 수 있어요."
];
const LUCKY_COLORS = ["라벤더","민트","코랄핑크","레몬옐로우","스카이블루","피치","화이트","베이지"];
const ENGLISH_QUOTES = [
  { en:"Small steps every day.", kr:"매일의 작은 발걸음." },
  { en:"Progress, not perfection.", kr:"완벽함이 아닌 나아감." },
  { en:"Done is better than perfect.", kr:"완벽보다 완료가 낫다." },
  { en:"Focus on what matters.", kr:"중요한 것에 집중하라." },
  { en:"One task at a time.", kr:"한 번에 한 가지씩." },
  { en:"Consistency beats intensity.", kr:"꾸준함이 강도를 이긴다." },
  { en:"Rest is productive too.", kr:"휴식도 생산적인 일이다." },
  { en:"Start where you are.", kr:"지금 있는 곳에서 시작하라." },
  { en:"Breathe. You've got this.", kr:"숨 고르고, 잘하고 있어요." },
  { en:"Small wins add up.", kr:"작은 성취가 쌓인다." },
  { en:"Clarity comes from action.", kr:"명확함은 행동에서 온다." },
  { en:"Keep it simple today.", kr:"오늘은 단순하게." }
];

// 문자열을 시드로 한 간단한 결정적 해시 (같은 입력이면 항상 같은 값)
function seededHash(str){
  let h = 0;
  for(let i=0;i<str.length;i++){
    h = (h*31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}
// 태어난 해로 띠(12지)를 계산 (2020년 = 쥐띠 기준)
function getZodiacAnimal(birthYear){
  const cycle = ['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지'];
  const idx = ((birthYear - 2020) % 12 + 12) % 12;
  return cycle[idx];
}
// 음력 설날(대략 1/21~2/20)은 매년 날짜가 달라서 정확한 변환은 어렵지만,
// 1월~2월 20일 이전 생일은 전년도 띠로 계산하는 근사치를 사용합니다.
function estimateZodiacYear(birthdate){
  const d = new Date(birthdate + 'T00:00:00');
  if(isNaN(d)) return new Date().getFullYear();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if(month === 1 || (month === 2 && day < 20)){
    return year - 1;
  }
  return year;
}

async function getUserProfile(){
  const saved = await storageGet('userProfile', null);
  return saved || DEFAULT_PROFILE;
}

let activeOtherProfile = null; // null이면 '내 운세', 값이 있으면 다른 사람 프로필

async function renderFortuneForDate(dateStr){
  const profile = activeOtherProfile || await getUserProfile();
  const seedStr = `${dateStr}|${profile.birthdate}|${profile.gender}`;
  const seed = seededHash(seedStr);

  const fortune = FORTUNES[seed % FORTUNES.length];
  const luckyColor = LUCKY_COLORS[Math.floor(seed / 7) % LUCKY_COLORS.length];
  const luckyNumber = (seed % 9) + 1;

  const zodiac = getZodiacAnimal(estimateZodiacYear(profile.birthdate || '1992-01-01'));

  document.getElementById('fortuneWhoLabel').textContent = activeOtherProfile ? '이 사람의 운세' : '오늘의 운세';
  document.getElementById('fortuneText').textContent = fortune;
  document.getElementById('fortuneExtra').textContent =
    `${zodiac}띠 · 행운의 색 ${luckyColor} · 행운의 숫자 ${luckyNumber}`;
}

// 오늘의 영어 한마디: 2시간 단위로 랜덤하게 새로 뽑습니다 (같은 2시간 안에서는 유지돼요)
async function renderEnglishQuote(){
  const now = new Date();
  const bucket = Math.floor(now.getHours() / 2);
  const windowKey = `${todayStr()}-${bucket}`;

  const cached = await storageGet('engQuoteCache', null);
  let eq;
  if(cached && cached.windowKey === windowKey){
    eq = cached.quote;
  } else {
    eq = ENGLISH_QUOTES[Math.floor(Math.random() * ENGLISH_QUOTES.length)];
    await storageSet('engQuoteCache', { windowKey, quote: eq });
  }
  document.getElementById('engSentence').textContent = eq.en;
  document.getElementById('engMeaning').textContent = eq.kr;
}

function renderFortune(){
  const jumpEl = document.getElementById('fortuneDateJump');
  const dateStr = (jumpEl && jumpEl.value) ? jumpEl.value : todayStr();
  if(jumpEl && !jumpEl.value) jumpEl.value = todayStr();
  renderFortuneForDate(dateStr);
}

document.getElementById('fortuneDateJump').addEventListener('change', (e)=>{
  renderFortuneForDate(e.target.value || todayStr());
});

document.getElementById('fortuneOtherToggle').addEventListener('click', ()=>{
  const fields = document.getElementById('fortuneOtherFields');
  fields.style.display = fields.style.display === 'none' ? 'flex' : 'none';
});
// "1991-05-15", "1991.5.15", "1991/5/15" 등 흔한 구분자를 모두 YYYY-MM-DD로 정리합니다.
function parseFlexibleDate(input){
  const m = (input||'').trim().match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if(!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if(month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
document.getElementById('fortuneApplyBtn').addEventListener('click', ()=>{
  const gender = document.getElementById('fortuneGenderInput').value;
  const birthdateRaw = document.getElementById('fortuneBirthInput').value;
  const birthdate = parseFlexibleDate(birthdateRaw);
  if(!birthdate){ alert('생일을 "YYYY-MM-DD" 형식으로 입력해주세요. (예: 1991-05-15)'); return; }
  activeOtherProfile = { gender, birthdate };
  renderFortune();
});
document.getElementById('fortuneResetBtn').addEventListener('click', ()=>{
  activeOtherProfile = null;
  document.getElementById('fortuneOtherFields').style.display = 'none';
  renderFortune();
});

/* ===================================================================
   중장기 과제 / 팀 일정
=================================================================== */
let expandedMidLongIds = new Set();

function renderMidLong(){
  const el = document.getElementById('midLongList');
  const list = getSortedMidLong().filter(m => !m.done); // 완료된 과제는 이 카드에서는 숨깁니다 (이력 페이지에서 확인 가능)
  el.innerHTML = list.map(m=>{
    const subtasks = STATE.tasks.filter(t=>t.midLongId===m.id);
    const doneCount = subtasks.filter(t=>t.done).length;
    const isExpanded = expandedMidLongIds.has(m.id);
    const prog = computeMidLongProgress(m);
    return `
      <div class="midlong-item ${m.done?'done':''}" data-id="${m.id}">
        <div class="midlong-row">
          <input type="checkbox" class="midlong-check" data-id="${m.id}" ${m.done?'checked':''}>
          <span class="priority-dot" style="background:${PRIORITY_COLOR[m.priority]||PRIORITY_COLOR.medium}"></span>
          <div class="midlong-main" data-id="${m.id}">
            <div class="midlong-title">${escapeHtml(m.title)}</div>
            <div class="midlong-dates">📅 ${formatMD(m.startDate)} ~ ${formatMD(m.dueDate)}</div>
          </div>
          ${subtasks.length ? `<button class="midlong-toggle" data-id="${m.id}">${isExpanded?'▾':'▸'} ${doneCount}/${subtasks.length}</button>` : ''}
          <button class="task-delete-btn midlong-delete-btn" data-id="${m.id}" title="삭제" aria-label="삭제">✕</button>
        </div>
        ${!m.done ? `
          <div class="midlong-progress-wrap">
            <div class="midlong-progress-bar"><div class="midlong-progress-fill ${prog.overdue?'overdue':''}" style="width:${prog.pct}%"></div></div>
            <span class="midlong-progress-label ${prog.overdue?'overdue':''}">${prog.label}</span>
          </div>
        ` : `<div class="midlong-progress-label done-label">✅ 완료 · ${formatMD(m.completedAt||m.dueDate)}</div>`}
        ${isExpanded && subtasks.length ? `
          <div class="midlong-subtasks">
            ${subtasks.map(t=>`<div class="midlong-subtask ${t.done?'done':''}" data-id="${t.id}"><span class="sub-dot"></span>${escapeHtml(t.text)}${t.memo || t.link ? ' <span class="memo-mark" title="메모 있음">📝</span>' : ''}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('') || '<div class="empty">등록된 과제가 없어요</div>';

  el.querySelectorAll('.midlong-check').forEach(cb=>{
    cb.addEventListener('click', e=>e.stopPropagation());
    cb.addEventListener('change', async e=>{
      const id = Number(e.target.dataset.id);
      const m = STATE.midlong.find(x=>x.id===id);
      if(m){
        m.done = e.target.checked;
        m.completedAt = e.target.checked ? todayStr() : null;
        await storageSet('midLongTasks', STATE.midlong);
        renderMidLong();
      }
    });
  });
  el.querySelectorAll('.midlong-toggle').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const id = Number(e.currentTarget.dataset.id);
      if(expandedMidLongIds.has(id)) expandedMidLongIds.delete(id); else expandedMidLongIds.add(id);
      renderMidLong();
    });
  });
  el.querySelectorAll('.midlong-delete-btn').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      const id = Number(e.currentTarget.dataset.id);
      STATE.midlong = STATE.midlong.filter(m=>m.id!==id);
      await storageSet('midLongTasks', STATE.midlong);
      renderMidLong();
      renderTasks();
    });
  });
  el.querySelectorAll('.midlong-main').forEach(main=>{
    main.addEventListener('click', ()=> openMidLongModal(Number(main.dataset.id)));
  });
  el.querySelectorAll('.midlong-subtask').forEach(row=>{
    row.addEventListener('click', ()=> openTaskModal(Number(row.dataset.id)));
  });
}

document.getElementById('addMidLongBtn').addEventListener('click', addMidLong);
document.getElementById('newMidLongInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') addMidLong();
});
async function addMidLong(){
  const input = document.getElementById('newMidLongInput');
  const prioritySelect = document.getElementById('newMidLongPriority');
  const startInput = document.getElementById('newMidLongStart');
  const dueInput = document.getElementById('newMidLongDue');
  const title = input.value.trim();
  if(!title) return;
  if(!startInput.value || !dueInput.value){
    alert('시작일과 완료목표일을 모두 선택해주세요.');
    return;
  }
  const nextId = STATE.midlong.length ? Math.max(...STATE.midlong.map(m=>m.id))+1 : 1;
  STATE.midlong.push({
    id: nextId,
    title,
    startDate: startInput.value,
    dueDate: dueInput.value,
    priority: prioritySelect.value || 'medium',
    done: false,
    completedAt: null,
    memo: '',
    link: ''
  });
  await storageSet('midLongTasks', STATE.midlong);
  input.value = '';
  startInput.value = '';
  dueInput.value = '';
  renderMidLong();
}

/* ===================================================================
   중장기 과제 상세 모달
=================================================================== */
let currentMidLongModalId = null;
function openMidLongModal(id){
  const m = STATE.midlong.find(x=>x.id===id);
  if(!m) return;
  currentMidLongModalId = id;
  document.getElementById('midLongModalTitleInput').value = m.title || '';
  document.getElementById('midLongModalPriority').value = m.priority || 'medium';
  document.getElementById('midLongModalStart').value = m.startDate || '';
  document.getElementById('midLongModalDue').value = m.dueDate || '';
  document.getElementById('midLongModalMemo').value = m.memo || '';
  document.getElementById('midLongModalLink').value = m.link || '';
  updateMidLongLinkPreview(m.link || '');
  document.getElementById('midLongModalOverlay').style.display = 'flex';
}
function closeMidLongModal(){
  document.getElementById('midLongModalOverlay').style.display = 'none';
  currentMidLongModalId = null;
}
async function saveMidLongModal(){
  const m = STATE.midlong.find(x=>x.id===currentMidLongModalId);
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
  await storageSet('midLongTasks', STATE.midlong);
  closeMidLongModal();
  renderMidLong();
  renderTasks();
}
function updateMidLongLinkPreview(link){
  const el = document.getElementById('midLongModalLinkPreview');
  el.innerHTML = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(link)}</a>` : '';
}
document.getElementById('midLongModalClose').addEventListener('click', closeMidLongModal);
document.getElementById('midLongModalCancel').addEventListener('click', closeMidLongModal);
document.getElementById('midLongModalSave').addEventListener('click', saveMidLongModal);
document.getElementById('midLongModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'midLongModalOverlay') closeMidLongModal();
});
document.getElementById('midLongModalLink').addEventListener('input', (e)=> updateMidLongLinkPreview(e.target.value.trim()));
document.getElementById('midLongModalDelete').addEventListener('click', async ()=>{
  if(currentMidLongModalId == null) return;
  STATE.midlong = STATE.midlong.filter(m=>m.id!==currentMidLongModalId);
  await storageSet('midLongTasks', STATE.midlong);
  closeMidLongModal();
  renderMidLong();
  renderTasks();
});

/* ===================================================================
   중장기 프로젝트 이력 → 새 페이지(midlong-history.html)로 열기
=================================================================== */
document.querySelectorAll('.midlong-history-trigger').forEach(el=>{
  el.addEventListener('click', ()=>{
    const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('midlong-history.html')
      : 'midlong-history.html';
    window.open(url, '_blank');
  });
});

function renderTeam(){
  const weekStart = STATE.teamWeekStart;
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);

  const dowNames = ['일','월','화','수','목','금','토'];
  document.getElementById('teamWeekLabel').textContent =
    `${weekStart.getMonth()+1}/${weekStart.getDate()} ~ ${weekEnd.getMonth()+1}/${weekEnd.getDate()}`;

  // 이 주에 해당하는 일정만 걸러서 날짜순으로 정렬
  const weekDates = [];
  for(let i=0;i<7;i++){
    const d = new Date(weekStart); d.setDate(d.getDate()+i);
    weekDates.push(dateToStr(d));
  }
  const byDate = {};
  weekDates.forEach(ds=> byDate[ds] = []);
  STATE.team.forEach(t=>{
    if(t.isSelf) return; // 본인 항목은 팀 일정에서 제외
    if(byDate[t.date]) byDate[t.date].push(t);
  });

  const el = document.getElementById('teamList');
  let html = '';
  let hasAny = false;
  weekDates.forEach((ds, i)=>{
    const items = byDate[ds].slice().sort((a,b)=> (a.time||'').localeCompare(b.time||''));
    if(items.length === 0) return;
    hasAny = true;
    const d = new Date(ds+'T00:00:00');
    html += `<div class="team-day-group">
      <div class="day-label">${d.getMonth()+1}/${d.getDate()} (${dowNames[i]})</div>
      ${items.map(t=>`
        <div class="team-item ${t.isSelf?'self':''}">
          <div class="d">${escapeHtml(t.time||'')}</div>
          <div>${escapeHtml(t.text)}</div>
        </div>
      `).join('')}
    </div>`;
  });
  el.innerHTML = hasAny ? html : '<div class="empty">이번 주엔 등록된 팀 일정이 없어요</div>';
}

document.getElementById('teamPrevWeek').addEventListener('click', ()=>{
  STATE.teamWeekStart.setDate(STATE.teamWeekStart.getDate()-7);
  renderTeam();
});
document.getElementById('teamNextWeek').addEventListener('click', ()=>{
  STATE.teamWeekStart.setDate(STATE.teamWeekStart.getDate()+7);
  renderTeam();
});
document.getElementById('teamDateJump').addEventListener('change', (e)=>{
  if(!e.target.value) return;
  const picked = new Date(e.target.value+'T00:00:00');
  STATE.teamWeekStart = startOfWeek(picked);
  renderTeam();
});
document.getElementById('teamThisWeekBtn').addEventListener('click', ()=>{
  STATE.teamWeekStart = startOfWeek(new Date());
  renderTeam();
});

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// 다른 탭(전체 업무 이력, 중장기 프로젝트 이력 등)에서 데이터를 바꾸면,
// 이 탭도 자동으로 최신 상태로 다시 그립니다. (수동 새로고침 없이도 반영돼요)
if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged){
  chrome.storage.onChanged.addListener((changes, area)=>{
    if(area !== 'local') return;
    if(changes.personalTasks || changes.midLongTasks || changes.fursysPlannerData || changes.flexLeaveData || changes.annualLeave || changes.teamSchedule){
      init();
    }
    // background.js가 직접 저장한 경우(스마트오피스/Flex 동기화)도 클라우드에 반영합니다.
    if(typeof scheduleCloudPush === 'function'){
      ['personalTasks','midLongTasks','personalEvents','userProfile','fursysPlannerData','flexLeaveData'].forEach(k=>{
        if(changes[k]) scheduleCloudPush(k);
      });
    }
  });
}

/* ===================================================================
   클라우드 동기화 (Firebase Firestore REST API) — PC ↔ 패드 데이터 공유
   * MV3 확장프로그램 페이지는 원격 SDK 스크립트를 불러올 수 없어서,
     Firebase JS SDK 대신 Firestore의 REST API를 fetch()로 직접 호출합니다.
   * 문서 하나(planners/girang)에 전체 데이터를 저장하고, updatedAt 값으로
     "마지막 수정 시각"을 비교해서 최신 쪽을 반영합니다.
=================================================================== */
const FIREBASE_PROJECT_ID = "planner-c5afc";
const FIREBASE_API_KEY = "AIzaSyBLqYfI7c0bFpBhsKQxpvck5gR-6ZqKCL4";
const FIRESTORE_DOC_URL =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/planners/girang?key=${FIREBASE_API_KEY}`;

const CLOUD_SYNC_KEYS = ['personalTasks', 'midLongTasks', 'personalEvents', 'userProfile', 'fursysPlannerData', 'flexLeaveData'];
let lastAppliedCloudTimestamp = null;
let cloudPushTimer = null;

function scheduleCloudPush(key){
  if(!CLOUD_SYNC_KEYS.includes(key)) return;
  if(cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(()=>{ pushToCloud(); }, 1500);
}

function firestoreFieldsToObject(fields){
  const result = {};
  if(!fields) return result;
  Object.keys(fields).forEach(k=>{
    const v = fields[k];
    if(v.stringValue !== undefined){
      try{ result[k] = JSON.parse(v.stringValue); } catch(e){ result[k] = null; }
    } else if(v.timestampValue !== undefined){
      result[k] = v.timestampValue;
    }
  });
  return result;
}

async function pullFromCloud(){
  try{
    const res = await fetch(FIRESTORE_DOC_URL);
    if(!res.ok){
      if(res.status !== 404) console.warn('[클라우드 동기화] 불러오기 실패 status:', res.status);
      return; // 404면 아직 문서가 없는 첫 실행 상태 — 무시하고 넘어감
    }
    const doc = await res.json();
    const data = firestoreFieldsToObject(doc.fields);
    const remoteTs = data.updatedAt || null;
    if(!remoteTs) return;
    if(lastAppliedCloudTimestamp && remoteTs <= lastAppliedCloudTimestamp) return; // 이미 반영된 데이터

    let changed = false;
    for(const key of CLOUD_SYNC_KEYS){
      if(data[key] !== undefined && data[key] !== null){
        await storageSet(key, data[key]);
        changed = true;
      }
    }
    lastAppliedCloudTimestamp = remoteTs;
    if(changed) init();
  }catch(e){
    console.warn('[클라우드 동기화] 불러오기 오류:', e.message);
  }
}

async function pushToCloud(){
  try{
    const nowIso = new Date().toISOString();
    const fields = { updatedAt: { timestampValue: nowIso } };
    for(const key of CLOUD_SYNC_KEYS){
      const value = await storageGet(key, null);
      fields[key] = { stringValue: JSON.stringify(value) };
    }
    const res = await fetch(FIRESTORE_DOC_URL, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fields })
    });
    if(!res.ok){
      console.warn('[클라우드 동기화] 올리기 실패 status:', res.status);
      return;
    }
    lastAppliedCloudTimestamp = nowIso; // 방금 내가 올린 값이므로, 다음 폴링에서 다시 안 당겨오게 표시
  }catch(e){
    console.warn('[클라우드 동기화] 올리기 오류:', e.message);
  }
}

// 30초마다 클라우드에 새 데이터가 있는지 확인 (다른 기기에서 바꾼 내용 반영)
setInterval(pullFromCloud, 30 * 1000);
// 페이지가 열리자마자 한 번 확인
pullFromCloud();

init();

// 페이지를 오래 켜두는 동안에도, 5분마다 '시간이 지난 회의' 자동 체크 및 영어 한마디 교체 시점을 다시 확인합니다.
setInterval(async ()=>{
  const meetingChanged = STATE.hasRealSyncedMeetings ? syncTasksFromMeetings() : false;
  const eventChanged = syncPersonalEventTaskCompletion();
  if(meetingChanged || eventChanged){
    await storageSet('personalTasks', STATE.tasks);
    renderTasks();
    renderProgress();
    renderMidLong();
  }
  renderEnglishQuote();
  renderCalendar(); // 퇴근시간(오후 5시반)이 지나면 오늘 도장이 자동으로 찍히도록 다시 그림
}, 5 * 60 * 1000);

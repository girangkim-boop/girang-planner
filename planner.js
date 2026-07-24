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
  taskViewDate: todayStr(),
  timelineViewDate: todayStr()
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
  STATE.timelineColors = await storageGet('timelineColors', {});

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
document.getElementById('timelinePrevDay').addEventListener('click', ()=>{
  const d = new Date((STATE.timelineViewDate || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  STATE.timelineViewDate = dateToStr(d);
  renderTimeline();
});
document.getElementById('timelineNextDay').addEventListener('click', ()=>{
  const d = new Date((STATE.timelineViewDate || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  STATE.timelineViewDate = dateToStr(d);
  renderTimeline();
});
document.getElementById('timelineTodayBtn').addEventListener('click', ()=>{
  STATE.timelineViewDate = todayStr();
  renderTimeline();
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
          if(ev.color !== undefined && ev.color !== null && TIMELINE_COLOR_OPTIONS[ev.color]){
            const c = TIMELINE_COLOR_OPTIONS[ev.color];
            bar.style.background = c.border;
            bar.style.color = '#fff';
          }
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
      let styleAttr = '';
      if(m.manual){
        const ev = STATE.personalEvents.find(e => String(e.id) === String(m.eventId));
        if(ev && ev.color !== undefined && ev.color !== null && TIMELINE_COLOR_OPTIONS[ev.color]){
          const c = TIMELINE_COLOR_OPTIONS[ev.color];
          styleAttr = ` style="background:${c.border}; color:#fff;"`;
        }
      }
      inner += `<span class="mini-event ${m.manual ? 'manual' : ''}" ${m.manual ? `data-event-id="${m.eventId}"` : ''}${styleAttr}>${startTime ? startTime+' ' : ''}${escapeHtml(m.title||'')}</span>`;
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
  document.querySelectorAll('.mini-more').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation(); // 날짜 셀의 기본 클릭(일정 추가 팝업)이 같이 뜨지 않도록 막습니다.
      const cell = el.closest('.cal-cell[data-date]');
      if(!cell) return;
      STATE.selectedDate = cell.dataset.date;
      renderCalendar();
      renderDayDetail(STATE.selectedDate);
      const detailCard = document.getElementById('dayDetailCard');
      if(detailCard) detailCard.scrollIntoView({ behavior:'smooth', block:'nearest' });
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
let currentEventModalColor = null;

function renderEventColorRow(selected){
  currentEventModalColor = selected !== undefined ? selected : null;
  const row = document.getElementById('eventModalColorRow');
  row.innerHTML =
    TIMELINE_COLOR_OPTIONS.map((c,i)=>`<button type="button" class="event-color-swatch ${currentEventModalColor===i?'selected':''}" data-idx="${i}" title="${c.name}" style="background:${c.border}"></button>`).join('') +
    `<button type="button" class="event-color-swatch reset ${currentEventModalColor===null?'selected':''}" data-idx="reset" title="기본색">↺</button>`;
  row.querySelectorAll('.event-color-swatch').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      currentEventModalColor = btn.dataset.idx === 'reset' ? null : Number(btn.dataset.idx);
      row.querySelectorAll('.event-color-swatch').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

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
    renderEventColorRow(ev.color !== undefined ? ev.color : null);
  } else {
    document.getElementById('eventModalHeading').textContent = '일정 추가';
    document.getElementById('eventModalTitleInput').value = '';
    document.getElementById('eventModalStartDate').value = dateStr;
    document.getElementById('eventModalEndDate').value = '';
    document.getElementById('eventModalStartTime').value = '09:00';
    document.getElementById('eventModalEndTime').value = '10:00';
    document.getElementById('eventModalMemo').value = '';
    document.getElementById('eventModalDelete').style.display = 'none';
    renderEventColorRow(null);
  }
  document.getElementById('eventModalOverlay').style.display = 'flex';
}
function closeEventModal(){
  document.getElementById('eventModalOverlay').style.display = 'none';
  currentEventModalDate = null;
  currentEventModalId = null;
  currentEventModalColor = null;
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
  const ev = { id, title, startDate, endDate, startTime, endTime, memo, color: currentEventModalColor };

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
// 겹치는 시간대의 블럭들을 같은 줄에 나란히(컬럼 분할) 배치하기 위한 계산
function layoutTimelineEvents(events){
  const sorted = events.slice().sort((a,b)=> a.startMin - b.startMin || a.endMin - b.endMin);
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  sorted.forEach(ev=>{
    if(current.length && ev.startMin >= clusterEnd){
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  });
  if(current.length) clusters.push(current);

  clusters.forEach(cluster=>{
    const columns = []; // 각 컬럼의 마지막 종료 시각
    cluster.forEach(ev=>{
      let placed = false;
      for(let i=0;i<columns.length;i++){
        if(ev.startMin >= columns[i]){
          columns[i] = ev.endMin;
          ev._col = i;
          placed = true;
          break;
        }
      }
      if(!placed){
        columns.push(ev.endMin);
        ev._col = columns.length - 1;
      }
    });
    cluster.forEach(ev=>{ ev._colCount = columns.length; });
  });
  return sorted;
}

// 타임라인 블럭에 사용자가 고를 수 있는 색상 5가지
const TIMELINE_COLOR_OPTIONS = [
  { name:'코랄(중요)', bg:'rgba(255,107,107,0.5)', border:'#E85D5D', text:'#8A2E2E' },
  { name:'옐로우',    bg:'rgba(255,209,102,0.5)', border:'#E0AC3F', text:'#7A5B12' },
  { name:'그린',      bg:'rgba(6,214,160,0.5)',   border:'#0DAE85', text:'#0C5C46' },
  { name:'블루',      bg:'rgba(77,150,255,0.5)',  border:'#3A7FE0', text:'#1F4E8C' },
  { name:'퍼플',      bg:'rgba(157,111,255,0.5)', border:'#8656E0', text:'#4A2E8C' }
];
function timelineColorKey(m, viewDate){
  return `${m.date || viewDate}|${m.time}|${m.title}`;
}
function closeTimelineColorPopover(){
  const existing = document.getElementById('tlColorPopover');
  if(existing) existing.remove();
}
async function setTimelineColor(key, colorIndex, eventId){
  const colors = STATE.timelineColors || {};
  if(colorIndex === null) delete colors[key];
  else colors[key] = colorIndex;
  STATE.timelineColors = colors;
  await storageSet('timelineColors', colors);

  // 내가 직접 추가한 일정이면, 캘린더 쪽 색상도 같이 맞춰줍니다 (서로 연동).
  if(eventId){
    const ev = STATE.personalEvents.find(e => String(e.id) === String(eventId));
    if(ev){
      ev.color = colorIndex;
      await storageSet('personalEvents', STATE.personalEvents);
      renderCalendar();
      renderDayDetail(STATE.selectedDate);
    }
  }

  closeTimelineColorPopover();
  renderTimeline();
}
function openTimelineColorPopover(targetEl, key, eventId){
  closeTimelineColorPopover();
  const pop = document.createElement('div');
  pop.id = 'tlColorPopover';
  pop.className = 'tl-color-popover';
  pop.innerHTML =
    TIMELINE_COLOR_OPTIONS.map((c,i)=>`<button class="tl-color-swatch" data-idx="${i}" title="${c.name}" style="background:${c.border}"></button>`).join('') +
    `<button class="tl-color-swatch tl-color-reset" data-idx="reset" title="기본색으로">↺</button>`;
  document.body.appendChild(pop);

  const rect = targetEl.getBoundingClientRect();
  pop.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  pop.style.left = (window.scrollX + rect.left) + 'px';

  pop.querySelectorAll('.tl-color-swatch').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const idx = btn.dataset.idx;
      setTimelineColor(key, idx === 'reset' ? null : Number(idx), eventId);
    });
  });
  setTimeout(()=>{
    document.addEventListener('click', closeTimelineColorPopover, { once:true });
  }, 0);
}

function renderTimeline(){
  const startHour = 7, endHour = 23;
  const el = document.getElementById('timeline');
  let html = '';
  for(let h=startHour; h<=endHour; h++){
    html += `<div class="tl-hour"><span class="label">${String(h).padStart(2,'0')}:00</span></div>`;
  }
  el.innerHTML = html;

  const today = todayStr();
  const viewDate = STATE.timelineViewDate || today;
  const isViewingToday = viewDate === today;
  const dayMeetingsForTimeline = STATE.meetings.filter(m => (!m.date || m.date === viewDate) && m.time && m.time.includes('-'));

  const labelEl = document.getElementById('timelineDayLabel');
  if(labelEl){
    const dLabel = new Date(viewDate + 'T00:00:00');
    const dowNames = ['일','월','화','수','목','금','토'];
    labelEl.textContent = isViewingToday ? '오늘' : `${dLabel.getMonth()+1}/${dLabel.getDate()} (${dowNames[dLabel.getDay()]})`;
  }

  const hourHeight = 52;
  const BASE_LEFT = 38, RIGHT_MARGIN = 10, GAP = 3;
  const MARGIN_TOTAL = BASE_LEFT + RIGHT_MARGIN;

  const eventObjs = [];
  dayMeetingsForTimeline.forEach(m=>{
    const [startStr, endStr] = m.time.split('-').map(s=>s.trim());
    const startMin = timeToMinutes(startStr), endMin = timeToMinutes(endStr);
    if(startMin === null || endMin === null) return;
    eventObjs.push({ m, startMin, endMin });
  });

  // 연차도 타임라인에 표시합니다. "종일"이면 하루 전체, "HH:MM~HH:MM"이면 그 시간만.
  const leaveStr = STATE.leave ? STATE.leave[viewDate] : null;
  if(leaveStr){
    const segments = leaveStr.split(',').map(s=>s.trim()).filter(Boolean);
    segments.forEach(seg=>{
      let sMin, eMin, label;
      if(seg.includes('~')){
        const [s,e] = seg.split('~').map(x=>x.trim());
        sMin = timeToMinutes(s); eMin = timeToMinutes(e);
        label = `연차 ${seg}`;
      } else {
        sMin = startHour*60; eMin = endHour*60; // 종일
        label = '연차 (종일)';
      }
      if(sMin === null || eMin === null) return;
      eventObjs.push({
        m: { title: label, time:'', manual:true, isLeave:true },
        startMin: sMin, endMin: eMin
      });
    });
  }

  const laidOut = layoutTimelineEvents(eventObjs);

  laidOut.forEach(({m, startMin, endMin, _col, _colCount})=>{
    const dayStartMin = startHour*60;
    const top = ((startMin - dayStartMin)/60)*hourHeight;
    const height = Math.max(((endMin-startMin)/60)*hourHeight, 20);
    // JS로 픽셀 너비를 미리 재지 않고, 실제 렌더링 시점의 너비를 CSS calc()가
    // 그때그때 계산하도록 해서, 측정 시점이 어긋나 한쪽으로 쏠리는 문제를 없앱니다.
    const leftCalc = `calc(${BASE_LEFT}px + (100% - ${MARGIN_TOTAL}px) * ${_col}/${_colCount})`;
    const widthCalc = `calc((100% - ${MARGIN_TOTAL}px)/${_colCount}${_col < _colCount-1 ? ` - ${GAP}px` : ''})`;
    const div = document.createElement('div');
    div.className = 'tl-event' + (m.manual ? ' manual' : '');
    div.style.top = top + 'px';
    div.style.height = height + 'px';
    div.style.left = leftCalc;
    div.style.width = widthCalc;

    const colorKey = timelineColorKey(m, viewDate);
    // 내가 직접 추가한 일정이면, 캘린더에서 정한 색상을 우선 적용합니다 (서로 연동).
    let linkedEvent = null;
    if(m.manual && m.eventId){
      linkedEvent = STATE.personalEvents.find(e => String(e.id) === String(m.eventId));
    }
    const colorIdx = (linkedEvent && linkedEvent.color !== undefined && linkedEvent.color !== null)
      ? linkedEvent.color
      : (STATE.timelineColors || {})[colorKey];
    if(colorIdx !== undefined && colorIdx !== null && TIMELINE_COLOR_OPTIONS[colorIdx]){
      const c = TIMELINE_COLOR_OPTIONS[colorIdx];
      div.style.background = c.bg;
      div.style.borderLeftColor = c.border;
      div.style.color = c.text;
    } else if(m.isLeave){
      // 커스텀 색이 없으면, 캘린더의 연차 색(피치)을 기본으로 씁니다.
      div.style.background = 'rgba(255,217,168,0.5)';
      div.style.borderLeftColor = 'var(--peach-deep)';
      div.style.color = '#7A5B12';
    }
    div.style.cursor = 'pointer';
    div.addEventListener('click', (e)=>{
      e.stopPropagation();
      openTimelineColorPopover(div, colorKey, m.eventId || null);
    });

    if(m.manual){
      div.innerHTML = `<div class="tl-event-title">${escapeHtml(m.title)}</div>`;
    } else {
      const sub = [m.time, m.rooms].filter(Boolean).join(' · ');
      div.innerHTML = `<div class="tl-event-title">${escapeHtml(m.title)}</div>${sub ? `<div class="tl-event-sub">${escapeHtml(sub)}</div>` : ''}`;
    }
    el.appendChild(div);
  });

  if(isViewingToday){
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
  { en:"Keep it simple today.", kr:"오늘은 단순하게." },
  { en:"Trust the process.", kr:"과정을 믿어라." },
  { en:"Every expert was once a beginner.", kr:"모든 전문가도 처음엔 초보였다." },
  { en:"Do it scared.", kr:"두려워도 일단 해보자." },
  { en:"Discipline is choosing what you want most.", kr:"규율은 가장 원하는 것을 선택하는 일이다." },
  { en:"You don't have to be great to start.", kr:"완벽하지 않아도 시작할 수 있다." },
  { en:"Momentum builds motivation.", kr:"작은 추진력이 동기를 만든다." },
  { en:"Slow progress is still progress.", kr:"느려도 나아가고 있는 것이다." },
  { en:"Make today count.", kr:"오늘을 의미 있게." },
  { en:"Stay curious.", kr:"호기심을 잃지 말자." },
  { en:"Good things take time.", kr:"좋은 일은 시간이 걸린다." },
  { en:"You are doing better than you think.", kr:"생각보다 잘하고 있어요." },
  { en:"Celebrate small victories.", kr:"작은 승리를 축하하자." },
  { en:"Effort compounds.", kr:"노력은 쌓인다." },
  { en:"Simplify, then focus.", kr:"단순화하고, 집중하자." },
  { en:"Be patient with yourself.", kr:"스스로에게 조금 더 관대하게." },
  { en:"Action cures fear.", kr:"행동이 두려움을 이긴다." },
  { en:"One page a day is a book a year.", kr:"하루 한 페이지면 일 년에 책 한 권." },
  { en:"Show up, even on hard days.", kr:"힘든 날에도 나타나는 것." },
  { en:"Your pace is enough.", kr:"지금의 속도로도 충분해요." },
  { en:"Choose progress over perfect.", kr:"완벽보다 전진을 택하자." },
  { en:"Little by little, a little becomes a lot.", kr:"조금씩 쌓이면 많아진다." },
  { en:"Done today beats perfect someday.", kr:"오늘의 완료가 언젠가의 완벽보다 낫다." },
  { en:"Energy flows where focus goes.", kr:"집중하는 곳에 에너지가 흐른다." },
  { en:"Quiet progress is still progress.", kr:"조용한 전진도 전진이다." },
  { en:"Today is a fresh page.", kr:"오늘은 새로운 페이지." },
  { en:"Steady hands finish the race.", kr:"꾸준한 손이 결승선에 닿는다." },
  { en:"Small habits, big changes.", kr:"작은 습관이 큰 변화를 만든다." },
  { en:"You are allowed to rest.", kr:"쉬어도 괜찮아요." },
  { en:"Growth is rarely comfortable.", kr:"성장은 좀처럼 편하지 않다." },
  { en:"Keep showing up for yourself.", kr:"스스로를 위해 계속 나타나기." },
  { en:"Direction matters more than speed.", kr:"속도보다 방향이 중요하다." },
  { en:"Finish what you start today.", kr:"오늘 시작한 건 오늘 끝내기." },
  { en:"Progress loves patience.", kr:"전진은 인내를 좋아한다." },
  { en:"A calm mind gets more done.", kr:"차분한 마음이 더 많은 걸 해낸다." },
  { en:"Turn intentions into actions.", kr:"의도를 행동으로 바꾸자." },
  { en:"You're closer than you think.", kr:"생각보다 가까이 왔어요." },
  { en:"Tiny steps still move you forward.", kr:"작은 걸음도 앞으로 나아가는 것." },
  { en:"Focus on the next step, not the whole staircase.", kr:"계단 전체보다 다음 한 칸에 집중하자." },
  { en:"Be proud of how far you've come.", kr:"여기까지 온 것에 자부심을 가지세요." },
  { en:"Consistency is a quiet superpower.", kr:"꾸준함은 조용한 초능력이다." },
  { en:"Your future self will thank you.", kr:"미래의 나에게 좋은 선물을." },
  { en:"Start messy, refine later.", kr:"일단 시작하고, 다듬는 건 나중에." },
  { en:"Don't wait for motivation, create momentum.", kr:"동기를 기다리지 말고 흐름을 만들자." },
  { en:"Small effort, repeated daily, wins.", kr:"매일의 작은 노력이 결국 이긴다." },
  { en:"Peace begins with a clear list.", kr:"평온은 정리된 목록에서 시작된다." },
  { en:"Today's work is tomorrow's ease.", kr:"오늘의 수고가 내일의 여유가 된다." },
  { en:"Be kind to your future self.", kr:"미래의 나에게 다정하게." },
  { en:"You don't need to rush, just move.", kr:"서두르지 않아도 되니 움직이기만." },
  { en:"Every sunset is a new dawn's promise.", kr:"모든 노을은 새 아침의 약속이다." },
  { en:"Better an oops than a what if.", kr:"'만약에'보다는 '어이쿠'가 낫다." },
  { en:"Small steps still count as moving.", kr:"작은 걸음도 움직이는 것이다." },
  { en:"Your only limit is your mind.", kr:"유일한 한계는 마음뿐이다." },
  { en:"Fall seven times, stand up eight.", kr:"일곱 번 넘어져도 여덟 번 일어나라." },
  { en:"Not all storms come to disrupt your life.", kr:"모든 폭풍이 삶을 흔들려는 건 아니다." },
  { en:"Difficult roads lead to beautiful destinations.", kr:"험한 길이 아름다운 목적지로 이어진다." },
  { en:"Do what you can with what you have.", kr:"가진 것으로 할 수 있는 걸 하자." },
  { en:"The best view comes after the hardest climb.", kr:"가장 힘든 오르막 뒤에 최고의 전망이 있다." },
  { en:"Push yourself, no one else will.", kr:"나를 밀어붙이는 건 결국 나 자신이다." },
  { en:"Great things never came from comfort zones.", kr:"위대한 일은 안전지대에서 나오지 않는다." },
  { en:"Dream it, wish it, do it.", kr:"꿈꾸고, 바라고, 실행하라." },
  { en:"Success doesn't just find you.", kr:"성공은 저절로 찾아오지 않는다." },
  { en:"It always seems impossible until it's done.", kr:"해내기 전까진 늘 불가능해 보인다." },
  { en:"Wake up with determination, sleep with satisfaction.", kr:"결심으로 깨어나, 만족으로 잠들자." },
  { en:"Little things make big days.", kr:"작은 것들이 큰 하루를 만든다." },
  { en:"Don't stop when you're tired, stop when you're done.", kr:"지쳤을 때가 아니라 끝났을 때 멈추자." },
  { en:"Dream big and dare to fail.", kr:"크게 꿈꾸고 실패를 두려워 말자." },
  { en:"Nothing worth having comes easy.", kr:"가질 만한 가치가 있는 건 쉽게 오지 않는다." },
  { en:"A little progress each day adds up.", kr:"매일의 작은 전진이 쌓인다." },
  { en:"Well begun is half done.", kr:"시작이 반이다." },
  { en:"Hard work beats talent when talent doesn't work hard.", kr:"재능이 게으르면 노력이 이긴다." },
  { en:"Success is the sum of small efforts.", kr:"성공은 작은 노력들의 합이다." },
  { en:"Believe you can and you're halfway there.", kr:"할 수 있다고 믿으면 이미 반은 온 것." },
  { en:"Your attitude determines your direction.", kr:"태도가 방향을 정한다." },
  { en:"Do what is right, not what is easy.", kr:"쉬운 것 말고 옳은 것을 하자." },
  { en:"Strive for progress, not perfection.", kr:"완벽이 아니라 전진을 추구하자." },
  { en:"Don't count the days, make the days count.", kr:"날짜를 세지 말고, 하루하루를 의미 있게." },
  { en:"You are stronger than you know.", kr:"생각보다 당신은 강하다." },
  { en:"A goal without a plan is just a wish.", kr:"계획 없는 목표는 소망일 뿐." },
  { en:"Doubt kills more dreams than failure ever will.", kr:"실패보다 의심이 더 많은 꿈을 죽인다." },
  { en:"Today's accomplishments were yesterday's impossibilities.", kr:"오늘의 성취는 어제의 불가능이었다." },
  { en:"Do good today, thank yourself tomorrow.", kr:"오늘 잘 해두면, 내일의 내가 고마워한다." },
  { en:"The secret of getting ahead is getting started.", kr:"앞서가는 비결은 일단 시작하는 것." },
  { en:"You are capable of amazing things.", kr:"당신은 놀라운 일을 해낼 수 있다." },
  { en:"Work hard in silence, let success speak.", kr:"조용히 노력하고, 성공이 말하게 하라." },
  { en:"Little by little, the impossible becomes possible.", kr:"조금씩, 불가능이 가능이 된다." },
  { en:"Never give up on a good day.", kr:"좋은 날을 포기하지 말자." },
  { en:"Stay positive, work hard, make it happen.", kr:"긍정적으로, 열심히, 이뤄내자." },
  { en:"Great things take time.", kr:"위대한 일은 시간이 걸린다." },
  { en:"Wherever you are, be all there.", kr:"어디에 있든, 온전히 그곳에 있자." },
  { en:"Don't wish it were easier, wish you were better.", kr:"쉽길 바라지 말고, 더 나아지길 바라자." },
  { en:"Success usually comes to those too busy to look for it.", kr:"성공은 바빠서 찾을 틈 없는 이에게 온다." },
  { en:"Be so good they can't ignore you.", kr:"무시할 수 없을 만큼 잘하자." },
  { en:"Opportunities don't happen, you create them.", kr:"기회는 오는 게 아니라 만드는 것." },
  { en:"You get in life what you have the courage to ask for.", kr:"용기 내어 요청한 만큼 얻는다." },
  { en:"Don't limit your challenges, challenge your limits.", kr:"도전을 제한하지 말고, 한계에 도전하라." },
  { en:"What you get by achieving your goals is who you become.", kr:"목표를 이루며 얻는 건, 되어가는 나 자신이다." },
  { en:"The harder you work, the luckier you get.", kr:"열심히 할수록 운도 따른다." },
  { en:"Focus on the step in front of you, not the whole staircase.", kr:"계단 전체 말고, 눈앞의 한 칸에 집중하자." },
  { en:"You don't have to see the whole staircase.", kr:"계단 전체를 다 볼 필요는 없다." },
  { en:"Time you enjoy wasting is not wasted time.", kr:"즐겁게 쓴 시간은 낭비가 아니다." },
  { en:"The way to get started is to quit talking and begin doing.", kr:"시작하는 법은, 말을 멈추고 행동하는 것." },
  { en:"Perfection is not attainable, but chasing it gets us excellence.", kr:"완벽은 못 이뤄도, 쫓다 보면 탁월함에 닿는다." },
  { en:"I find that the harder I work, the more luck I have.", kr:"열심히 할수록 더 많은 운이 따랐다." },
  { en:"Don't be afraid to give up the good for the great.", kr:"더 나은 것을 위해 좋은 것을 놓아줄 용기." },
  { en:"Fix your eyes on the goal, not the obstacles.", kr:"장애물이 아니라 목표에 시선을 두자." },
  { en:"You are never too old to set a new goal.", kr:"새 목표를 세우기에 늦은 나이는 없다." },
  { en:"Everything you can imagine is real.", kr:"상상할 수 있는 모든 것은 현실이 될 수 있다." },
  { en:"It does not matter how slowly you go.", kr:"얼마나 느리게 가는지는 중요하지 않다." },
  { en:"Whether you think you can or can't, you're right.", kr:"할 수 있다고 믿든 못한다고 믿든, 맞는 말이 된다." },
  { en:"Winners are not afraid of losing.", kr:"승자는 지는 것을 두려워하지 않는다." },
  { en:"If you get tired, learn to rest, not to quit.", kr:"지치면 쉬는 법을 배우되, 포기하지 말자." },
  { en:"A year from now you may wish you had started today.", kr:"1년 후, 오늘 시작하지 않은 걸 후회할지도." },
  { en:"Only I can change my life.", kr:"내 삶을 바꿀 수 있는 건 나뿐이다." },
  { en:"There is no elevator to success, only stairs.", kr:"성공으로 가는 엘리베이터는 없고, 계단뿐이다." },
  { en:"Do something today your future self will thank you for.", kr:"미래의 나에게 고마움을 받을 오늘의 행동." },
  { en:"Positive anything is better than negative nothing.", kr:"긍정적인 무언가는 부정적인 아무것보다 낫다." },
  { en:"Success is not final, failure is not fatal.", kr:"성공은 끝이 아니고, 실패도 치명적이지 않다." },
  { en:"Your limitation is only your imagination.", kr:"한계는 오직 상상 속에만 있다." },
  { en:"Sometimes later becomes never.", kr:"나중은 때때로 영원히 오지 않는다." },
  { en:"Great works are performed not by strength but by perseverance.", kr:"위대한 일은 힘이 아니라 끈기로 이뤄진다." },
  { en:"The expert in anything was once a beginner.", kr:"모든 전문가도 한때는 초보였다." },
  { en:"You are the sky, everything else is just weather.", kr:"당신은 하늘이고, 나머지는 그저 날씨일 뿐." },
  { en:"Habits are the compound interest of self-improvement.", kr:"습관은 자기계발의 복리 이자다." },
  { en:"The pain of discipline weighs less than regret.", kr:"절제의 고통은 후회보다 가볍다." },
  { en:"Motivation gets you going, habit keeps you going.", kr:"동기는 출발시키고, 습관은 계속 가게 한다." },
  { en:"You do not rise to the level of your goals.", kr:"목표의 수준까지 오르는 게 아니라," },
  { en:"You fall to the level of your systems.", kr:"시스템의 수준으로 떨어질 뿐이다." },
  { en:"Every action is a vote for who you want to become.", kr:"모든 행동은 되고 싶은 나를 향한 한 표다." },
  { en:"Master the boring basics.", kr:"지루한 기본기부터 마스터하자." },
  { en:"A small change today changes tomorrow's trajectory.", kr:"오늘의 작은 변화가 내일의 궤적을 바꾼다." },
  { en:"Never let the future disturb you.", kr:"미래가 오늘을 흔들게 두지 말자." },
  { en:"He who has a why can bear almost any how.", kr:"이유가 있는 사람은 어떤 방법도 견딘다." },
  { en:"What stands in the way becomes the way.", kr:"가로막던 것이 결국 길이 된다." },
  { en:"The impediment to action advances action.", kr:"행동을 막는 장애가 오히려 행동을 앞당긴다." },
  { en:"Waste no more time arguing about a good life.", kr:"좋은 삶에 대해 논쟁하는 대신, 살아가자." },
  { en:"You have power over your mind, not outside events.", kr:"바깥 사건이 아니라 내 마음은 내가 다스린다." },
  { en:"First say to yourself what you would be.", kr:"먼저 되고 싶은 나를 그려보라." },
  { en:"Confidence comes not from always being right.", kr:"자신감은 늘 옳아서 오는 게 아니라," },
  { en:"but from not fearing to be wrong.", kr:"틀려도 두렵지 않은 데서 온다." },
  { en:"To improve is to change often.", kr:"나아진다는 건, 자주 바뀐다는 것." },
  { en:"Not how long, but how well you have lived.", kr:"얼마나 오래가 아니라, 얼마나 잘 살았는가." },
  { en:"He who is brave is free.", kr:"용감한 자는 자유롭다." },
  { en:"Knowing yourself is the beginning of all wisdom.", kr:"자신을 아는 것이 모든 지혜의 시작이다." },
  { en:"An unexamined life is not worth living.", kr:"성찰 없는 삶은 살 가치가 없다." },
  { en:"We suffer more in imagination than in reality.", kr:"현실보다 상상 속에서 더 괴로워한다." },
  { en:"It's not what happens, but how you react.", kr:"무슨 일이 아니라, 어떻게 반응하느냐다." },
  { en:"The soul becomes dyed with the color of its thoughts.", kr:"영혼은 생각의 색으로 물든다." },
  { en:"Very little is needed to make a happy life.", kr:"행복한 삶에는 아주 적은 것만 필요하다." },
  { en:"Freedom is not being controlled by anything.", kr:"자유란 무엇에도 휘둘리지 않는 것." },
  { en:"Choose not to be harmed and you won't feel harmed.", kr:"상처받지 않기로 하면, 상처받지 않는다." },
  { en:"Man is disturbed not by things, but by his view of them.", kr:"사람은 사건이 아니라 그 해석에 흔들린다." },
  { en:"Every new beginning comes from some other beginning's end.", kr:"모든 새 시작은 어떤 끝에서 온다." },
  { en:"Do not spoil what you have by desiring what you don't.", kr:"없는 걸 바라다 있는 걸 망치지 말자." },
  { en:"You cannot control the wind, but you can adjust your sails.", kr:"바람은 못 바꿔도, 돛은 조정할 수 있다." },
  { en:"Change your thoughts and you change your world.", kr:"생각을 바꾸면 세상이 바뀐다." },
  { en:"Simplicity is the ultimate sophistication.", kr:"단순함이 최고의 정교함이다." },
  { en:"Less is more.", kr:"적을수록 좋다." },
  { en:"Have nothing that is not useful or beautiful.", kr:"쓸모없거나 아름답지 않은 건 두지 말자." },
  { en:"Clarity precedes success.", kr:"명확함이 성공보다 먼저 온다." },
  { en:"Order and simplification are the first steps.", kr:"정돈과 단순화가 첫걸음이다." },
  { en:"A cluttered space is a cluttered mind.", kr:"어지러운 공간은 어지러운 마음이다." },
  { en:"Simplify, then add lightness.", kr:"단순화하고, 가볍게 만들자." },
  { en:"The ability to simplify means to eliminate the unnecessary.", kr:"단순화란 불필요함을 덜어내는 능력이다." },
  { en:"Focus is saying no to a thousand things.", kr:"집중은 천 가지에 아니오라고 말하는 것." },
  { en:"What you don't do determines what you can do.", kr:"안 하는 것이, 할 수 있는 것을 결정한다." },
  { en:"Concentrate all your thoughts upon the work at hand.", kr:"지금 하는 일에 모든 생각을 모으자." },
  { en:"The successful warrior is the average person with laser focus.", kr:"성공한 이는 평범해도 레이저 같은 집중을 가진 사람이다." },
  { en:"Where focus goes, energy flows.", kr:"집중이 향하는 곳으로 에너지가 흐른다." },
  { en:"Starve distraction, feed focus.", kr:"산만함은 굶기고, 집중은 먹이자." },
  { en:"You can do anything, but not everything.", kr:"무엇이든 할 수 있지만, 전부는 아니다." },
  { en:"One thing at a time, most important thing first.", kr:"한 번에 하나씩, 가장 중요한 것부터." },
  { en:"Simplicity boils down to two steps: identify essential, eliminate rest.", kr:"단순함이란 본질을 찾고 나머지를 없애는 것." },
  { en:"Rest and self-care are essential.", kr:"휴식과 자기돌봄은 필수적이다." },
  { en:"Almost everything will work again if unplugged.", kr:"거의 모든 건 잠깐 멈추면 다시 작동한다." },
  { en:"Take a break, it's not the end of the road.", kr:"잠시 쉬어도, 끝이 아니다." },
  { en:"Sometimes the most productive thing is rest.", kr:"때로는 쉬는 게 가장 생산적이다." },
  { en:"Slow down and everything you are chasing will come around.", kr:"천천히 가면, 쫓던 것들이 다가온다." },
  { en:"You can't pour from an empty cup.", kr:"빈 컵에서는 따를 게 없다." },
  { en:"Self-care is not selfish.", kr:"자기돌봄은 이기적인 게 아니다." },
  { en:"Rest when you're weary, refresh and renew yourself.", kr:"지치면 쉬고, 새롭게 채우자." },
  { en:"Peace begins with a smile.", kr:"평화는 미소에서 시작된다." },
  { en:"Almost everything works again if you give it some time.", kr:"거의 모든 것은 시간을 주면 다시 나아진다." },
  { en:"Calm mind brings inner strength.", kr:"차분한 마음이 내면의 힘을 만든다." },
  { en:"Silence is sometimes the best answer.", kr:"침묵이 때론 최선의 답이다." },
  { en:"Breathe, this too shall pass.", kr:"숨 쉬어요, 이 또한 지나갈 거예요." },
  { en:"Gratitude turns what we have into enough.", kr:"감사는 가진 것을 충분한 것으로 만든다." },
  { en:"Enjoy the little things in life.", kr:"삶의 작은 것들을 즐기자." },
  { en:"Count your blessings, not your problems.", kr:"문제가 아니라 감사할 일을 세어보자." },
  { en:"Gratitude is the healthiest of all human emotions.", kr:"감사는 인간 감정 중 가장 건강한 것이다." },
  { en:"Appreciate what you have before it becomes what you had.", kr:"잃기 전에, 가진 것을 소중히 여기자." },
  { en:"A grateful heart is a magnet for miracles.", kr:"감사하는 마음은 기적을 끌어당긴다." },
  { en:"Today, be grateful for the small things.", kr:"오늘은 작은 것들에 감사해보자." },
  { en:"Gratitude changes everything.", kr:"감사가 모든 것을 바꾼다." },
  { en:"Curiosity is the wick in the candle of learning.", kr:"호기심은 배움이라는 촛불의 심지다." },
  { en:"Stay hungry, stay foolish.", kr:"늘 갈망하고, 우직하게." },
  { en:"The important thing is not to stop questioning.", kr:"중요한 건 질문을 멈추지 않는 것." },
  { en:"Learning never exhausts the mind.", kr:"배움은 마음을 지치게 하지 않는다." },
  { en:"An investment in knowledge pays the best interest.", kr:"지식에 대한 투자가 최고의 이자를 낸다." },
  { en:"Curiosity leads to the best discoveries.", kr:"호기심이 최고의 발견으로 이어진다." },
  { en:"Ask questions, you'll find answers.", kr:"질문하면, 답을 찾게 된다." },
  { en:"Creativity is intelligence having fun.", kr:"창의성은 즐겁게 노는 지능이다." },
  { en:"Every artist was first an amateur.", kr:"모든 예술가도 처음엔 아마추어였다." },
  { en:"You can't use up creativity.", kr:"창의성은 써도 없어지지 않는다." },
  { en:"The more you use it, the more you have.", kr:"쓰면 쓸수록 더 많아진다." },
  { en:"Think outside the box.", kr:"틀 밖에서 생각하자." },
  { en:"Imagination is more important than knowledge.", kr:"상상력이 지식보다 중요하다." },
  { en:"Creativity takes courage.", kr:"창의성에는 용기가 필요하다." },
  { en:"Confidence is silent, insecurities are loud.", kr:"자신감은 조용하고, 불안은 시끄럽다." },
  { en:"Believe in yourself and all that you are.", kr:"자기 자신과 자신의 가능성을 믿자." },
  { en:"You are enough just as you are.", kr:"지금 모습 그대로도 충분하다." },
  { en:"Self-doubt is the biggest enemy of progress.", kr:"자기 의심이 전진의 가장 큰 적이다." },
  { en:"Trust yourself, you know more than you think.", kr:"자신을 믿자, 생각보다 많이 알고 있다." },
  { en:"Confidence comes from preparation.", kr:"자신감은 준비에서 나온다." },
  { en:"Nobody can make you feel inferior without consent.", kr:"동의 없이는 누구도 나를 열등하게 만들 수 없다." },
  { en:"Teamwork makes the dream work.", kr:"팀워크가 꿈을 이뤄낸다." },
  { en:"Alone we can do so little, together so much.", kr:"혼자면 조금, 함께면 많이 할 수 있다." },
  { en:"Coming together is a beginning, working together is success.", kr:"모이는 건 시작, 함께 일하는 건 성공이다." },
  { en:"None of us is as smart as all of us.", kr:"우리 모두를 합친 것보다 똑똑한 개인은 없다." },
  { en:"Great things in business are never done by one person.", kr:"큰일은 한 사람이 해내는 게 아니다." },
  { en:"If you want to go fast, go alone.", kr:"빨리 가려면 혼자 가고," },
  { en:"If you want to go far, go together.", kr:"멀리 가려면 함께 가라." },
  { en:"Time is what we want most, but use worst.", kr:"시간은 가장 원하지만, 가장 함부로 쓰는 것." },
  { en:"Lost time is never found again.", kr:"잃어버린 시간은 다시 찾을 수 없다." },
  { en:"Time you enjoy wasting was not wasted.", kr:"즐겁게 흘려보낸 시간은 낭비가 아니다." },
  { en:"The key is not spending time, but investing it.", kr:"시간을 쓰는 게 아니라 투자하는 것." },
  { en:"Yesterday is gone, tomorrow has not yet come.", kr:"어제는 갔고, 내일은 아직 오지 않았다." },
  { en:"We have only today, let us begin.", kr:"우리에겐 오늘만 있으니, 시작하자." },
  { en:"Until we have begun, all things are hard.", kr:"시작하기 전까지는 모든 게 어렵다." },
  { en:"A journey of a thousand miles begins with one step.", kr:"천 리 길도 한 걸음부터." },
  { en:"The best time to start was yesterday, the next best is now.", kr:"최적의 때는 어제였고, 차선은 지금이다." },
  { en:"Begin anywhere.", kr:"어디서든 시작하라." },
  { en:"Just start.", kr:"일단 시작하라." },
  { en:"Getting started is the hardest part.", kr:"시작이 가장 어렵다." },
  { en:"A journey is best measured in friends, not miles.", kr:"여정은 거리보다 함께한 사람으로 잰다." },
  { en:"Resilience is accepting your new reality.", kr:"회복력은 새로운 현실을 받아들이는 것." },
  { en:"Tough times never last, tough people do.", kr:"힘든 시절은 지나가도, 강한 사람은 남는다." },
  { en:"Rock bottom became the solid foundation.", kr:"바닥이 튼튼한 기반이 되었다." },
  { en:"When you go through hardship, keep going.", kr:"고난 속에서도, 계속 나아가라." },
  { en:"Storms make trees take deeper roots.", kr:"폭풍이 나무 뿌리를 더 깊게 만든다." },
  { en:"Out of difficulties grow miracles.", kr:"어려움 속에서 기적이 자란다." },
  { en:"The oak fought the wind and was broken.", kr:"참나무는 바람과 싸우다 부러졌지만," },
  { en:"the willow bent and survived.", kr:"버드나무는 휘어져 살아남았다." },
  { en:"What doesn't kill you makes you stronger.", kr:"죽지 않을 만큼의 시련은 강하게 만든다." },
  { en:"Every adversity carries the seed of equal benefit.", kr:"모든 역경은 그만큼의 이로움을 품고 있다." },
  { en:"You may have to fight a battle more than once to win.", kr:"승리하려면 같은 싸움을 여러 번 해야 할 때도 있다." },
  { en:"Kindness is a language the deaf can hear.", kr:"친절은 귀 먹은 이도 들을 수 있는 언어다." },
  { en:"Be the reason someone smiles today.", kr:"오늘, 누군가를 웃게 하는 이유가 되자." },
  { en:"No act of kindness is ever wasted.", kr:"친절은 결코 헛되지 않는다." },
  { en:"A warm smile is the universal language.", kr:"따뜻한 미소는 만국 공통어다." },
  { en:"Carry out a random act of kindness today.", kr:"오늘 뜻밖의 친절 하나를 베풀어보자." },
  { en:"Be kind whenever possible, it is always possible.", kr:"가능하면 친절하라, 언제나 가능하다." },
  { en:"Patience is not the ability to wait.", kr:"인내는 기다리는 능력이 아니라," },
  { en:"but how you act while waiting.", kr:"기다리는 동안 어떻게 행동하느냐다." },
  { en:"Good things come to those who wait.", kr:"좋은 일은 기다리는 사람에게 온다." },
  { en:"Patience is bitter, but its fruit is sweet.", kr:"인내는 쓰지만 그 열매는 달다." },
  { en:"Adopt the pace of nature, patience is her secret.", kr:"자연의 속도를 따르자, 인내가 자연의 비결이다." },
  { en:"Slow and steady wins the race.", kr:"천천히 그리고 꾸준함이 경주를 이긴다." },
  { en:"Rivers know this: there is no hurry.", kr:"강물은 안다, 서두를 필요가 없다는 걸." },
  { en:"Trust the timing of your life.", kr:"내 삶의 타이밍을 믿자." },
  { en:"An ounce of practice is worth a ton of theory.", kr:"한 줌의 실천이 한 트럭의 이론보다 낫다." },
  { en:"Learning by doing.", kr:"하면서 배운다." },
  { en:"The only way to learn is to do.", kr:"배우는 유일한 길은 해보는 것." },
  { en:"Experience is the best teacher.", kr:"경험이 최고의 스승이다." },
  { en:"Fail fast, learn faster.", kr:"빨리 실패하고, 더 빨리 배우자." },
  { en:"Mistakes are proof you are trying.", kr:"실수는 시도하고 있다는 증거다." },
  { en:"There is no failure, only feedback.", kr:"실패는 없다, 피드백만 있을 뿐." },
  { en:"Every mistake is a lesson in disguise.", kr:"모든 실수는 변장한 교훈이다." },
  { en:"Fall down seven times, get up eight.", kr:"일곱 번 넘어져도 여덟 번 일어서라." },
  { en:"You miss 100% of the shots you don't take.", kr:"쏘지 않은 슛은 100% 빗나간다." },
  { en:"The comeback is always stronger than the setback.", kr:"컴백은 늘 셋백보다 강하다." },
  { en:"Turn your wounds into wisdom.", kr:"상처를 지혜로 바꾸자." },
  { en:"Fear is temporary, regret is forever.", kr:"두려움은 잠깐, 후회는 영원하다." },
  { en:"Feel the fear and do it anyway.", kr:"두려워도 그냥 해보자." },
  { en:"Courage is not the absence of fear.", kr:"용기는 두려움이 없는 게 아니라," },
  { en:"but moving forward despite it.", kr:"그럼에도 나아가는 것이다." },
  { en:"Everything you want is on the other side of fear.", kr:"원하는 모든 건 두려움 너머에 있다." },
  { en:"Bravery is a choice you make daily.", kr:"용기는 매일 내리는 선택이다." },
  { en:"Life shrinks or expands with courage.", kr:"삶은 용기의 크기만큼 넓어지거나 좁아진다." },
  { en:"A comfort zone is a beautiful place, but nothing grows there.", kr:"안전지대는 아름답지만, 아무것도 자라지 않는다." },
  { en:"Change is hard at first, messy in the middle, gorgeous at the end.", kr:"변화는 처음엔 힘들고, 중간엔 혼란스럽고, 끝엔 아름답다." },
  { en:"Growth begins at the end of your comfort zone.", kr:"성장은 안전지대의 끝에서 시작된다." },
  { en:"What lies behind and before us are tiny matters.", kr:"과거와 미래는 작은 문제일 뿐," },
  { en:"compared to what lies within us.", kr:"내면에 있는 것에 비하면." },
  { en:"You were given this life because you are strong enough to live it.", kr:"이 삶을 견딜 만큼 강하기에 주어졌다." },
  { en:"Life is 10% what happens, 90% how you react.", kr:"인생은 10%의 사건과 90%의 반응이다." },
  { en:"Happiness is not by chance, but by choice.", kr:"행복은 우연이 아니라 선택이다." },
  { en:"The purpose of life is to live it fully.", kr:"삶의 목적은 온전히 사는 것." },
  { en:"Life is short, make every hair flip count.", kr:"인생은 짧으니, 매 순간을 소중히." },
  { en:"In the middle of difficulty lies opportunity.", kr:"어려움 한가운데 기회가 있다." },
  { en:"Keep your face to the sunshine.", kr:"얼굴을 늘 햇살 쪽으로 향하자." },
  { en:"and you cannot see the shadow.", kr:"그러면 그림자는 보이지 않는다." },
  { en:"Life is like riding a bicycle, keep moving to stay balanced.", kr:"인생은 자전거와 같아, 계속 움직여야 균형이 잡힌다." },
  { en:"Not all who wander are lost.", kr:"방황하는 모든 이가 길을 잃은 건 아니다." },
  { en:"Do more of what makes you happy.", kr:"나를 행복하게 하는 일을 더 하자." },
  { en:"Everything happens for a reason.", kr:"모든 일에는 이유가 있다." },
  { en:"Make each day your masterpiece.", kr:"하루하루를 걸작으로 만들자." },
  { en:"Life is a gift, that's why it's called the present.", kr:"인생은 선물이라, 현재라 불린다." },
  { en:"You only live once, but do it right.", kr:"인생은 한 번뿐, 제대로 살자." },
  { en:"The only impossible journey is the one you never begin.", kr:"유일하게 불가능한 여정은 시작조차 안 한 여정이다." },
  { en:"Do one thing every day that scares you.", kr:"매일 두려운 일 하나씩 해보자." },
  { en:"Nothing is impossible, the word itself says I'm possible.", kr:"불가능은 없다, 그 단어 자체가 '나는 가능하다'라고 말한다." },
  { en:"You are braver than you believe, stronger than you seem.", kr:"믿는 것보다 용감하고, 보이는 것보다 강하다." },
  { en:"Smarter than you think.", kr:"생각보다 똑똑하다." },
  { en:"Doubt kills more dreams than failure ever will.", kr:"실패보다 의심이 더 많은 꿈을 죽인다." },
  { en:"Success is walking from failure to failure with no loss of enthusiasm.", kr:"성공은 열정을 잃지 않고 실패를 거듭 걷는 것." },
  { en:"There are no shortcuts to any place worth going.", kr:"갈 만한 곳에 지름길은 없다." },
  { en:"The best revenge is massive success.", kr:"최고의 복수는 엄청난 성공이다." },
  { en:"Don't be pushed by your problems, be led by your dreams.", kr:"문제에 떠밀리지 말고, 꿈에 이끌리자." },
  { en:"The distance between dreams and reality is called action.", kr:"꿈과 현실 사이의 거리를 행동이라 부른다." },
  { en:"A dream doesn't become reality through magic.", kr:"꿈은 마법으로 이뤄지지 않고," },
  { en:"it takes sweat, determination, and hard work.", kr:"땀과 결심과 노력으로 이뤄진다." },
  { en:"Set your goals high, and don't stop till you get there.", kr:"목표는 높게, 도달할 때까지 멈추지 말자." },
  { en:"If you can dream it, you can do it.", kr:"꿈꿀 수 있다면, 해낼 수 있다." },
  { en:"Go as far as you can see, then you'll see further.", kr:"보이는 데까지 가면, 더 멀리 보이게 된다." },
  { en:"All our dreams can come true if we pursue them.", kr:"꿈을 좇으면, 모든 꿈은 이루어질 수 있다." },
  { en:"Ambition is the path to success.", kr:"야망은 성공으로 가는 길이다." },
  { en:"Persistence is the path to success.", kr:"끈기는 성공으로 가는 길이다." },
  { en:"It's not the load that breaks you down.", kr:"당신을 무너뜨리는 건 짐이 아니라," },
  { en:"it's the way you carry it.", kr:"그 짐을 짊어지는 방식이다." },
  { en:"Set your mind on a definite goal and observe how quickly the world stands aside.", kr:"확실한 목표를 세우면 세상이 길을 비켜준다." },
  { en:"Ordinary people believe only in the possible.", kr:"보통 사람은 가능한 것만 믿지만," },
  { en:"extraordinary people visualize the impossible.", kr:"비범한 사람은 불가능한 것을 그려본다." },
  { en:"Champions keep playing until they get it right.", kr:"챔피언은 될 때까지 계속한다." },
  { en:"You must expect great things of yourself before you can do them.", kr:"스스로 큰일을 기대해야 해낼 수 있다." },
  { en:"The only way to do great work is to love what you do.", kr:"위대한 일을 하는 법은, 하는 일을 사랑하는 것." },
  { en:"Setting goals is the first step in turning the invisible into visible.", kr:"목표를 세우는 건 보이지 않는 것을 보이게 하는 첫걸음이다." },
  { en:"Do not wait, the time will never be just right.", kr:"기다리지 말자, 완벽한 때는 오지 않는다." }
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
// 배열을 무작위로 섞습니다 (Fisher–Yates)
function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// 이번 주 월요일 날짜(YYYY-MM-DD)를 구합니다.
function mondayOfWeek(d){
  const date = new Date(d);
  const day = date.getDay(); // 0=일,1=월,...
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff);
  return dateToStr(date);
}

// 매주 월요일마다 문구 20개를 새로 뽑아서, 그 주 동안은 그 20개 안에서만
// 랜덤하게 나오도록 합니다. (전체 문구는 3주에 걸쳐 겹치지 않게 다 쓰이고,
// 그다음 다시 새로 섞여서 순환해요)
const WEEKLY_QUOTE_COUNT = 20;
async function getWeeklyQuoteSet(){
  const weekKey = mondayOfWeek(new Date());
  let weekly = await storageGet('engWeeklySet', null);
  if(weekly && weekly.weekKey === weekKey) return weekly;

  // 새로운 주: 전체 순환 커서에서 20개를 이어서 뽑습니다.
  let cycle = await storageGet('engPoolCycle', null);
  if(!cycle || !Array.isArray(cycle.order) || cycle.order.length !== ENGLISH_QUOTES.length){
    cycle = { order: shuffleArray(ENGLISH_QUOTES.map((_,i)=>i)), cursor: 0 };
  }
  const indices = [];
  while(indices.length < WEEKLY_QUOTE_COUNT){
    if(cycle.cursor >= cycle.order.length){
      cycle = { order: shuffleArray(ENGLISH_QUOTES.map((_,i)=>i)), cursor: 0 };
    }
    indices.push(cycle.order[cycle.cursor]);
    cycle.cursor++;
  }
  await storageSet('engPoolCycle', cycle);

  weekly = { weekKey, indices, order: shuffleArray(indices), pointer: 0 };
  await storageSet('engWeeklySet', weekly);
  return weekly;
}

async function getNextEnglishQuote(prevEn){
  let weekly = await getWeeklyQuoteSet();
  if(weekly.pointer >= weekly.order.length){
    // 이번 주 20개를 다 보여줬으면, 이번 주 안에서 다시 섞어서 계속 사용합니다.
    weekly = { ...weekly, order: shuffleArray(weekly.indices), pointer: 0 };
  }
  let idx = weekly.order[weekly.pointer];
  if(prevEn && ENGLISH_QUOTES[idx].en === prevEn && weekly.pointer + 1 < weekly.order.length){
    weekly.pointer++;
    idx = weekly.order[weekly.pointer];
  }
  weekly.pointer++;
  await storageSet('engWeeklySet', weekly);
  return ENGLISH_QUOTES[idx];
}

async function renderEnglishQuote(){
  const now = new Date();
  const bucket = Math.floor(now.getHours() / 2);
  const windowKey = `${todayStr()}-${bucket}`;

  const cached = await storageGet('engQuoteCache', null);
  let eq;
  if(cached && cached.windowKey === windowKey){
    eq = cached.quote;
  } else {
    const prevEn = cached && cached.quote ? cached.quote.en : null;
    eq = await getNextEnglishQuote(prevEn);
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
    if(changes.personalTasks || changes.midLongTasks || changes.fursysPlannerData || changes.flexLeaveData || changes.annualLeave || changes.teamSchedule || changes.timelineColors){
      init();
    }
    // background.js가 직접 저장한 경우(스마트오피스/Flex 동기화)도 클라우드에 반영합니다.
    if(typeof scheduleCloudPush === 'function'){
      ['personalTasks','midLongTasks','personalEvents','userProfile','fursysPlannerData','flexLeaveData','timelineColors'].forEach(k=>{
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

const CLOUD_SYNC_KEYS = ['personalTasks', 'midLongTasks', 'personalEvents', 'userProfile', 'fursysPlannerData', 'flexLeaveData', 'timelineColors'];
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

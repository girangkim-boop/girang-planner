/**
 * background.js
 * ------------------------------------------------------------------
 * 브라우저가 켜져있는 동안 조용히 계속 동작하는 백그라운드 스크립트입니다.
 *
 * 1) 스마트오피스(smart.fursys.com) 회의 데이터
 * 2) Flex(flex.team) 연차/휴가 데이터 (본인 + 동료)
 *
 * 두 가지를 주기적으로(1시간마다) 알아서 가져와 저장합니다. 필요한
 * 사이트를 열어두지 않아도, 세션이 만료된 것 같으면 안 보이는 탭을
 * 잠깐 열었다 닫아서 스스로 세션을 갱신합니다.
 *
 * ⚠️ 이건 "이미 로그인된 세션을 조용히 새로고침"하는 것일 뿐, 아이디/
 * 비밀번호를 대신 입력해주는 기능이 아닙니다. 회사 SSO(자동 로그인)로
 * 세션이 유지되는 환경이면 잘 동작하고, 매번 직접 로그인 절차가
 * 필요한 환경이면 이 자동 갱신도 실패할 수 있어요. 그럴 땐 딱 한 번만
 * 직접 로그인해주시면 다시 정상화돼요.
 * ------------------------------------------------------------------
 */

const SMART_API_BASE = "https://smart-api.fursys.com/v1/conferences/events";
const SMART_DAYS_BEFORE = 365;
const SMART_DAYS_AFTER = 180;
const SMART_REFRESH_URL = "https://smart.fursys.com/conference";

const FLEX_API_BASE = "https://flex.team/api/v2/calendar/calendars/events";
// 회원님 이름을 알려주시면 아래 값을 채워서, "본인 연차"를 정확히 구분합니다.
// (예: "홍길동") 비워두면 일단 모든 연차를 "팀 일정"에만 표시합니다.
const MY_FLEX_NAME = "김기랑";
const FLEX_DAYS_BEFORE = 180;
const FLEX_DAYS_AFTER = 180;
const FLEX_REFRESH_URL = "https://flex.team/";

const ALARM_NAME = "fursysPlannerSync";

// 진단용: 서비스워커가 (재)시작될 때마다 알람이 실제로 살아있는지, 다음 실행 예정
// 시각이 언제인지 콘솔에 찍어둡니다. "아침에 자동 동기화가 안 됐다" 싶을 때 이 로그로
// 알람이 끊긴 건지, 그냥 아직 순서가 안 온 건지 바로 구분할 수 있습니다.
chrome.alarms.get(ALARM_NAME, (alarm) => {
  if (!alarm) {
    console.log("[진단] 동기화 알람이 등록되어 있지 않습니다. onStartup/onInstalled가 아직 안 돈 상태일 수 있어요.");
  } else {
    console.log(`[진단] 동기화 알람 확인됨. 다음 예정 시각: ${new Date(alarm.scheduledTime).toLocaleString("ko-KR")}`);
  }
});


function fmtDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function isoToHHMM(iso) {
  if (!iso) return "";
  const match = iso.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}
function isoToDate(iso) {
  if (!iso) return fmtDate(new Date());
  return iso.slice(0, 10);
}
function buildWindows(daysBefore, daysAfter, chunkDays) {
  const today = new Date();
  const rangeStart = new Date(today); rangeStart.setDate(rangeStart.getDate() - daysBefore);
  const rangeEnd = new Date(today); rangeEnd.setDate(rangeEnd.getDate() + daysAfter);
  const windows = [];
  let cursor = new Date(rangeStart);
  while (cursor < rangeEnd) {
    const chunkFrom = new Date(cursor);
    const chunkTo = new Date(cursor);
    chunkTo.setDate(chunkTo.getDate() + chunkDays);
    if (chunkTo > rangeEnd) chunkTo.setTime(rangeEnd.getTime());
    windows.push([new Date(chunkFrom), new Date(chunkTo)]);
    cursor.setDate(cursor.getDate() + chunkDays + 1);
  }
  return windows;
}

/* ===================================================================
   스마트오피스 (회의)
=================================================================== */

// 페이지가 실제로 API를 호출할 때, 그 요청에 실린 진짜 Api-Token 값을 엿듣습니다.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const header = (details.requestHeaders || []).find(
      (h) => h.name.toLowerCase() === "api-token"
    );
    if (header && header.value) {
      chrome.storage.local.get(["fursysApiToken"], ({ fursysApiToken }) => {
        const isNewToken = fursysApiToken !== header.value;
        chrome.storage.local.set({ fursysApiToken: header.value }, () => {
          // 토큰이 새로 잡혔다면(로그인 직후 등), 다음 정기 알람을 기다리지 않고 바로 동기화합니다.
          if (isNewToken) scheduleImmediateSync();
        });
      });
    }
  },
  { urls: ["https://smart-api.fursys.com/*"] },
  ["requestHeaders"]
);

// MV3 백그라운드(서비스워커)는 대기 중일 때 언제든 꺼질 수 있어서, setTimeout으로
// 미루는 대신 즉시 실행하고, 짧은 시간 안에 중복 실행만 되지 않도록 막습니다.
// ⚠️ 동기화를 시작하는 진입점이 여러 곳(브라우저 시작/설치·업데이트/정기 알람/실시간 감지)
// 이라서, 이 잠금을 반드시 모든 진입점이 함께 거쳐가야 합니다. 그렇지 않으면 두 이벤트가
// 거의 동시에 발생했을 때 backgroundSync()가 잠금 없이 중복 실행됩니다.
let syncInFlight = false;
async function runBackgroundSync(reason) {
  if (syncInFlight) {
    console.log(`[자동 동기화] 이미 동기화가 진행 중이라 이번 요청(${reason})은 건너뜁니다.`);
    return;
  }
  syncInFlight = true;
  try {
    await backgroundSync(reason);
  } finally {
    setTimeout(() => { syncInFlight = false; }, 5000);
  }
}
function scheduleImmediateSync() {
  console.log("[자동 동기화] 새 인증 정보가 감지되어, 알람을 기다리지 않고 바로 동기화를 시작합니다.");
  runBackgroundSync("실시간 감지");
}

async function fetchAndStoreMeetings() {
  const { fursysUserId, fursysApiToken } = await chrome.storage.local.get(["fursysUserId", "fursysApiToken"]);
  if (!fursysUserId || !fursysApiToken) {
    return { ok: false, reason: "no-credentials" };
  }

  const windows = buildWindows(SMART_DAYS_BEFORE, SMART_DAYS_AFTER, 30);
  const allEventsById = new Map();
  let okChunks = 0, failedChunks = 0;

  for (const [from, to] of windows) {
    const url = `${SMART_API_BASE}?userId=${encodeURIComponent(fursysUserId)}&frDt=${fmtDate(from)}&toDt=${fmtDate(to)}&_=${Date.now()}`;
    try {
      const res = await fetch(url, { credentials: "include", headers: { "Api-Token": fursysApiToken } });
      if (!res.ok) { failedChunks++; continue; }
      const data = await res.json();
      const events = data.events || [];
      events.forEach((ev) => {
        const key = ev.eventId || `${ev.summary}-${ev.origStartDtIso}`;
        allEventsById.set(key, ev);
      });
      okChunks++;
    } catch (err) {
      failedChunks++;
    }
  }

  if (okChunks === 0 && failedChunks > 0) {
    return { ok: false, reason: "all-chunks-failed" };
  }

  const meetings = Array.from(allEventsById.values()).map((ev) => {
    const attendeeCandidates = ev.attendees || ev.guestNms || ev.attendeeNms || ev.participants || null;
    let attendees = "";
    if (Array.isArray(attendeeCandidates)) {
      attendees = attendeeCandidates
        .map((a) => (typeof a === "string" ? a : (a && (a.name || a.userNm || a.nm)) || ""))
        .filter(Boolean)
        .join(", ");
    }
    return {
      date: isoToDate(ev.origStartDtIso),
      time: `${isoToHHMM(ev.origStartDtIso)}-${isoToHHMM(ev.origEndDtIso)}`,
      title: ev.summary || "제목 없음",
      rooms: Array.isArray(ev.roomNms) ? ev.roomNms.join(", ") : "",
      attendees
    };
  });

  const now = new Date();
  const lastSynced = now.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }) + " (백그라운드 자동)";

  await chrome.storage.local.set({ fursysPlannerData: { meetings, lastSynced } });
  console.log(`[스마트오피스 연동] 회의 동기화 성공: ${meetings.length}건 (구간 성공 ${okChunks}/${windows.length})`);
  return { ok: true };
}

/* ===================================================================
   Flex (연차/휴가)
=================================================================== */

// 여러 요청이 거의 동시에 일어나도 값이 유실되지 않도록, 메모리에 Set으로
// 누적해두고 그때그때 storage에 반영합니다.
let flexCalendarIdSet = null;
async function ensureFlexCalendarIdSetLoaded() {
  if (flexCalendarIdSet) return;
  const { flexCalendarIds } = await chrome.storage.local.get(["flexCalendarIds"]);
  flexCalendarIdSet = new Set(Array.isArray(flexCalendarIds) ? flexCalendarIds : []);
}

// Flex 페이지가 실제로 캘린더 이벤트를 조회할 때, 요청 본문(body)에 실린
// calendarIds 값을 엿듣습니다. (이 값이 있어야 우리도 같은 요청을 할 수 있어요)
// ⚠️ Flex 홈피드는 "내 일정"과 "동료 일정"을 거의 동시에 서로 다른
// calendarIds로 각각 요청해서, 값을 누적할 때 경쟁 상태가 생기지 않도록
// 메모리 Set을 거쳐서 안전하게 저장합니다.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    (async () => {
      try {
        if (!details.requestBody) return;
        let bodyText = "";
        if (details.requestBody.raw && details.requestBody.raw[0] && details.requestBody.raw[0].bytes) {
          bodyText = new TextDecoder("utf-8").decode(new Uint8Array(details.requestBody.raw[0].bytes));
        }
        if (!bodyText) return;
        const parsed = JSON.parse(bodyText);
        if (Array.isArray(parsed.calendarIds) && parsed.calendarIds.length) {
          await ensureFlexCalendarIdSetLoaded();
          let changed = false;
          parsed.calendarIds.forEach((id) => {
            if (!flexCalendarIdSet.has(id)) { flexCalendarIdSet.add(id); changed = true; }
          });
          if (changed) {
            await chrome.storage.local.set({ flexCalendarIds: Array.from(flexCalendarIdSet) });
            scheduleImmediateSync(); // 새 calendarIds가 잡혔으니 알람을 기다리지 않고 바로 동기화
          }
        }
      } catch (e) {
        // JSON이 아니거나 형식이 다르면 그냥 무시합니다.
      }
    })();
  },
  { urls: ["https://flex.team/api/v2/calendar/calendars/events*"] },
  ["requestBody"]
);

// UTC(Z) ISO 문자열을 한국시간(KST) 기준 "YYYY-MM-DD" / "HH:MM"으로 변환합니다.
function flexDateKST(iso) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function flexTimeKST(iso) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return String(kst.getUTCHours()).padStart(2, "0") + ":" + String(kst.getUTCMinutes()).padStart(2, "0");
}
// "[이름]" 부분과, 끝에 중복으로 붙는 "- 3:30 PM ~ 5:30 PM" 같은 시간 표기를 정리합니다.
// (시간은 앞쪽에 별도 배지로 이미 표시하기 때문에 텍스트에서는 중복을 없애줍니다)
function cleanFlexTitle(title) {
  return (title || "")
    .replace(/^[^\[]*\[.+?\]\s*/, "")
    .replace(/\s*-\s*\d{1,2}:\d{2}\s*[AP]M\s*~\s*\d{1,2}:\d{2}\s*[AP]M\s*$/i, "")
    .trim();
}

// "[신정아] 휴가 - ..." 형태에서 이름을 뽑아냅니다. 이름이 없으면(본인) null.
function flexExtractPerson(title) {
  const m = title && title.match(/\[(.+?)\]/);
  return m ? m[1] : null;
}
function flexIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00+09:00`;
}

async function fetchAndStoreFlexLeaves() {
  const { flexCalendarIds } = await chrome.storage.local.get(["flexCalendarIds"]);
  if (!Array.isArray(flexCalendarIds) || flexCalendarIds.length === 0) {
    return { ok: false, reason: "no-calendar-ids" };
  }

  const windows = buildWindows(FLEX_DAYS_BEFORE, FLEX_DAYS_AFTER, 30);
  const leaveMap = {}; // { "2026-07-20": "종일" 또는 "08:30~12:30, 15:00~17:00" }
  const teamEntries = [];
  let okChunks = 0, failedChunks = 0;

  for (const [from, to] of windows) {
    const params = new URLSearchParams();
    params.set("dateTimeMin", flexIso(from));
    params.set("dateTimeMaxExclusive", flexIso(to));
    params.set("timeZone", "Etc/GMT-9");
    ["MEETING", "TIME_OFF", "WORK_RECORD", "ONE_ON_ONE", "INTERVIEW", "BIRTHDAY", "COMPANY_JOIN_DAY"].forEach((t) =>
      params.append("flexEventTypes", t)
    );
    params.set("size", "500");
    ["CONFIRMED", "TENTATIVE"].forEach((s) => params.append("statuses", s));

    const url = `${FLEX_API_BASE}?${params.toString()}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarIds: flexCalendarIds })
      });
      if (!res.ok) {
        failedChunks++;
        console.warn(`[Flex 연동] 구간 실패 ${fmtDate(from)}~${fmtDate(to)} status: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const list = data.list || [];
      list.forEach((item) => {
        try {
          if (item.flexEventType !== "TIME_OFF") return;
          const title = (item.flexEventJson && item.flexEventJson.title) || item.summary || "휴가";
          const person = flexExtractPerson(title);

          const startAt = item.startAt || {};
          const endAt = item.endAtExclusive || {};
          let dateStr, timeStr;
          if (startAt.dateTime) {
            // 반차/시간 단위 연차: 시각 정보가 있는 경우
            dateStr = flexDateKST(startAt.dateTime);
            const startTime = flexTimeKST(startAt.dateTime);
            const endTime = endAt.dateTime ? flexTimeKST(endAt.dateTime) : "";
            timeStr = endTime ? `${startTime}~${endTime}` : startTime;
          } else if (startAt.date) {
            // 종일(하루 전체) 연차: 날짜만 있고 시각 정보가 없는 경우
            dateStr = startAt.date;
            timeStr = "종일";
          } else {
            return; // 날짜 정보 자체가 없으면 건너뜁니다.
          }

          const isSelf = !person || (MY_FLEX_NAME && person === MY_FLEX_NAME);
          if (isSelf) {
            if (!leaveMap[dateStr]) leaveMap[dateStr] = [];
            leaveMap[dateStr].push(timeStr);
          } else {
            teamEntries.push({
              date: dateStr,
              text: `${person} · ${cleanFlexTitle(title)}`,
              time: timeStr
            });
          }
        } catch (itemErr) {
          console.warn("[Flex 연동] 항목 하나를 처리하지 못했어요:", itemErr.message);
        }
      });
      okChunks++;
    } catch (err) {
      failedChunks++;
      console.warn(`[Flex 연동] 구간 오류 ${fmtDate(from)}~${fmtDate(to)}:`, err.message);
    }
  }

  if (okChunks === 0 && failedChunks > 0) {
    return { ok: false, reason: "all-chunks-failed" };
  }

  teamEntries.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const leave = Object.keys(leaveMap).sort().map((date) => ({
    date,
    time: leaveMap[date].join(", ")
  }));

  const now = new Date();
  const lastSynced = now.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }) + " (백그라운드 자동)";

  await chrome.storage.local.set({
    flexLeaveData: { leave, team: teamEntries, lastSynced }
  });
  console.log(`[Flex 연동] 연차 동기화 성공: 본인 ${leave.length}일 / 팀 일정 ${teamEntries.length}건 (구간 성공 ${okChunks}/${windows.length})`);
  return { ok: true };
}

/* ===================================================================
   공통: 안 보이는 탭을 잠깐 열었다 닫아서 세션을 조용히 갱신
=================================================================== */
function silentRefreshTab(refreshUrl) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: refreshUrl, active: false }, (tab) => {
      if (!tab || !tab.id) { resolve(false); return; }
      const tabId = tab.id;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.remove(tabId, () => resolve(true));
      };

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          setTimeout(finish, 6000);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(finish, 25000);
    });
  });
}

/* ===================================================================
   동기화 이력 기록 (진단용)
   콘솔 로그는 서비스워커가 재시작되면 사라지므로, "그날 몇 시에 시도했고
   성공/실패했는지"를 나중에도 확인할 수 있도록 storage에 최근 50건을 남깁니다.
   확인법: 서비스워커 콘솔에서
     chrome.storage.local.get('syncDebugLog', r => console.table(r.syncDebugLog))
=================================================================== */
async function logSyncAttempt(entry) {
  try {
    const { syncDebugLog } = await chrome.storage.local.get(["syncDebugLog"]);
    const list = Array.isArray(syncDebugLog) ? syncDebugLog : [];
    list.push({ time: new Date().toISOString(), ...entry });
    while (list.length > 50) list.shift();
    await chrome.storage.local.set({ syncDebugLog: list });
  } catch (e) {
    console.log("[진단] 동기화 이력 저장 실패:", e);
  }
}

/* ===================================================================
   전체 동기화 흐름
=================================================================== */
async function backgroundSync(reason) {
  const meetingsResult = await fetchAndStoreMeetings();
  const flexResult = await fetchAndStoreFlexLeaves();

  if (meetingsResult.ok && flexResult.ok) {
    await logSyncAttempt({ reason, meetingsOk: true, flexOk: true, note: "정상 동기화" });
    return;
  }

  if (!meetingsResult.ok) {
    console.log("[스마트오피스 연동] 토큰이 없거나 만료된 것 같아요. 세션을 조용히 갱신해볼게요...");
    await silentRefreshTab(SMART_REFRESH_URL);
    const retry = await fetchAndStoreMeetings();
    console.log(retry.ok ? "[스마트오피스 연동] 세션 갱신 후 동기화 성공!" : "[스마트오피스 연동] 세션 갱신 후에도 실패했어요. smart.fursys.com에 직접 한 번 로그인해주세요.");
    await logSyncAttempt({ reason, meetingsOk: retry.ok, meetingsFailReason: retry.ok ? null : (retry.reason || "unknown") });
  }

  if (!flexResult.ok) {
    console.log("[Flex 연동] calendarIds가 없거나 요청이 실패했어요. 세션을 조용히 갱신해볼게요...");
    await silentRefreshTab(FLEX_REFRESH_URL);
    const retry = await fetchAndStoreFlexLeaves();
    console.log(retry.ok ? "[Flex 연동] 세션 갱신 후 동기화 성공!" : "[Flex 연동] 세션 갱신 후에도 실패했어요. flex.team에 직접 한 번 로그인해주세요.");
    await logSyncAttempt({ reason, flexOk: retry.ok, flexFailReason: retry.ok ? null : (retry.reason || "unknown") });
  }
}

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60, delayInMinutes: 1 });
  runBackgroundSync("브라우저 시작");
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60, delayInMinutes: 1 });
  runBackgroundSync("확장 설치/업데이트");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runBackgroundSync("정기 알람");
  }
});

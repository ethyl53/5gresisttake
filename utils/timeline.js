const { createCanvas } = require('canvas');

// 科目・色の共通定義（揺れを吸収しやすく整理）
const SUBJECT_MAP = {
    '数学': '#0074FF', 'blue': '#0074FF',
    '化学': '#66CCFF', 'lightblue': '#66CCFF',
    '物理': '#FFA500', 'orange': '#FFA500',
    '英語': '#FFFF00', 'yellow': '#FFFF00',
    '社会': '#00B000', 'green': '#00B000',
    'その他': '#FF0000', 'red': '#FF0000', 'purple': '#FF0000', 'gray': '#FF0000'
};

const SUBJECT_NAME = {
    '#0074FF': '数学',
    '#66CCFF': '化学',
    '#FFA500': '物理',
    '#FFFF00': '英語',
    '#00B000': '社会',
    '#FF0000': 'その他'
};

function resolveSubject(colorOrName) {
    if (!colorOrName) return { hex: '#FF0000', name: 'その他' };
    
    if (colorOrName.startsWith('#')) {
        const hex = colorOrName.toUpperCase();
        return { hex: hex, name: SUBJECT_NAME[hex] || 'その他' };
    }

    const key = colorOrName.toLowerCase();
    const hex = SUBJECT_MAP[key] || '#FF0000';
    return { hex, name: SUBJECT_NAME[hex] || 'その他' };
}

function formatTime(ms) {
    const totalMinutes = Math.floor(ms / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
}

function getTodayRange() {
    const d = new Date();
    const h = d.getHours();
    
    const start = new Date(d);
    if (h < 2) start.setDate(start.getDate() - 1);
    start.setHours(2, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(1, 59, 59, 999);
    
    return { startMs: start.getTime(), endMs: end.getTime() };
}

// 💡 修正：getTodayRangeを基準にすることで、重複や計算のズレを完全に防ぐ安全なロジックに変更
function getYesterdayRange() {
    const today = getTodayRange();
    const oneDayMs = 24 * 60 * 60 * 1000;
    return {
        startMs: today.startMs - oneDayMs,
        endMs: today.endMs - oneDayMs
    };
}

function getWeeklyRange() {
    const d = new Date();
    const currentDay = d.getDay(); // 0:日, 1:月, ..., 6:土
    const currentHour = d.getHours();

    let dayDiff = currentDay - 1;
    if (dayDiff < 0) dayDiff = 6;

    const startMonday = new Date(d);
    startMonday.setDate(startMonday.getDate() - dayDiff);
    startMonday.setHours(2, 0, 0, 0);

    if (currentDay === 1 && currentHour < 2) {
        startMonday.setDate(startMonday.getDate() - 7);
    }

    const startMs = startMonday.getTime();
    
    const endMonday = new Date(startMonday);
    endMonday.setDate(endMonday.getDate() + 7);
    endMonday.setHours(1, 59, 59, 999);
    const endMs = endMonday.getTime();

    return { startMs, endMs, nowMs: d.getTime() };
}

// 💡 軽量化・高速化：24時間タイムスロット配列を事前に生成してマッピングする高速アルゴリズム
function buildTimelineSlots(sessions, startMs) {
    const CELL_COUNT = 288;
    const slots = new Array(CELL_COUNT).fill('#404249'); // デフォルト背景色

    // 1. セッションの色でスロットを埋める
    for (const session of sessions) {
        const sIdx = Math.max(0, Math.floor((session.start - startMs) / (5 * 60 * 1000)));
        const eIdx = Math.min(CELL_COUNT - 1, Math.floor((session.end - startMs) / (5 * 60 * 1000)));
        
        for (let i = sIdx; i <= eIdx; i++) {
            slots[i] = session.colorHex;
        }

        // 2. 一時停止がある場合は背景色で上書きする
        if (session.pauses && session.pauses.length > 0) {
            for (const pause of session.pauses) {
                const psIdx = Math.max(0, Math.floor((pause.start - startMs) / (5 * 60 * 1000)));
                const peIdx = Math.min(CELL_COUNT - 1, Math.floor((pause.end - startMs) / (5 * 60 * 1000)));
                for (let i = psIdx; i <= peIdx; i++) {
                    slots[i] = '#404249';
                }
            }
        }
    }
    return slots;
}

// 単一/複数ユーザーの24時間タイムライン生成
async function generateTimelineBuffer(userData, startMs) {
    const CELL_COUNT = 288;
    const CELL_WIDTH = 3;
    const CELL_HEIGHT = 16;
    const CELL_MARGIN = 1;
    const ROW_HEIGHT = 40;
    const LABEL_WIDTH = 110;
    const PADDING = 22;

    const width = LABEL_WIDTH + (CELL_WIDTH + CELL_MARGIN) * CELL_COUNT + PADDING * 2;
    const height = PADDING * 2 + 36 + userData.length * ROW_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1f2124';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#3b3f45';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#e6ebf2';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 4) {
        const cellIndex = h * 12;
        const x = LABEL_WIDTH + PADDING + cellIndex * (CELL_WIDTH + CELL_MARGIN);
        const displayHour = (2 + h) % 24;
        ctx.fillText(`${String(displayHour).padStart(2, '0')}:00`, x, PADDING + 10);
    }

    let startY = PADDING + 30;
    ctx.textBaseline = 'middle';

    userData.forEach(user => {
        ctx.fillStyle = '#f7f8fa';
        ctx.textAlign = 'right';
        ctx.font = '13px sans-serif';
        ctx.fillText(user.username.slice(0, 16), LABEL_WIDTH + PADDING - 10, startY + ROW_HEIGHT / 2);

        const slots = buildTimelineSlots(user.sessions, startMs);
        for (let i = 0; i < CELL_COUNT; i++) {
            const x = LABEL_WIDTH + PADDING + i * (CELL_WIDTH + CELL_MARGIN);
            const y = startY + (ROW_HEIGHT - CELL_HEIGHT) / 2;

            ctx.fillStyle = slots[i];
            ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
            ctx.strokeStyle = '#3f434a';
            ctx.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT);
        }
        startY += ROW_HEIGHT;
    });

    const buffer = canvas.toBuffer('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return buffer;
}

// 1週間分（縦軸7曜日）のタイムライングラフ生成
async function generateWeeklyTimelineBuffer(username, sessions, startMondayMs) {
    const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
    const CELL_COUNT = 288;
    const CELL_WIDTH = 3;
    const CELL_HEIGHT = 16;
    const CELL_MARGIN = 1;
    const ROW_HEIGHT = 36;
    const LABEL_WIDTH = 90;
    const PADDING = 22;

    const width = LABEL_WIDTH + (CELL_WIDTH + CELL_MARGIN) * CELL_COUNT + PADDING * 2;
    const height = PADDING * 2 + 40 + DAYS.length * ROW_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1f2124';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#f7f8fa';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`週間タイムライン: ${username}`, PADDING, PADDING + 12);

    ctx.fillStyle = '#e6ebf2';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 4) {
        const cellIndex = h * 12;
        const x = LABEL_WIDTH + PADDING + cellIndex * (CELL_WIDTH + CELL_MARGIN);
        const displayHour = (2 + h) % 24;
        ctx.fillText(`${String(displayHour).padStart(2, '0')}:00`, x, PADDING + 32);
    }

    let startY = PADDING + 45;
    ctx.textBaseline = 'middle';

    DAYS.forEach((dayName, dayIndex) => {
        ctx.fillStyle = '#f7f8fa';
        ctx.textAlign = 'right';
        ctx.font = '13px sans-serif';
        ctx.fillText(`${dayName}曜日`, LABEL_WIDTH + PADDING - 10, startY + ROW_HEIGHT / 2);

        const dayStartMs = startMondayMs + dayIndex * 24 * 60 * 60 * 1000;
        const slots = buildTimelineSlots(sessions, dayStartMs);

        for (let i = 0; i < CELL_COUNT; i++) {
            const x = LABEL_WIDTH + PADDING + i * (CELL_WIDTH + CELL_MARGIN);
            const y = startY + (ROW_HEIGHT - CELL_HEIGHT) / 2;

            ctx.fillStyle = slots[i];
            ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
            ctx.strokeStyle = '#3f434a';
            ctx.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT);
        }
        startY += ROW_HEIGHT;
    });

    const buffer = canvas.toBuffer('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return buffer;
}

module.exports = {
    resolveSubject, formatTime, getTodayRange, getYesterdayRange, getWeeklyRange, generateTimelineBuffer, generateWeeklyTimelineBuffer
};
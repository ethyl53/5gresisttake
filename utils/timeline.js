const { createCanvas } = require('canvas');

// 科目・色の共通定義
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

function getYesterdayRange() {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    
    const start = new Date(d);
    if (start.getHours() < 2) start.setDate(start.getDate() - 1);
    start.setHours(2, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(1, 59, 59, 999);
    
    return { startMs: start.getTime(), endMs: end.getTime() };
}

// 直近の月曜日02:00 〜 翌月曜日01:59 を計算
function getWeeklyRange() {
    const d = new Date();
    const currentDay = d.getDay(); // 0:日, 1:月, ..., 6:土
    const currentHour = d.getHours();

    let dayDiff = currentDay - 1;
    if (dayDiff < 0) dayDiff = 6; // 日曜日の場合は6日前

    const startMonday = new Date(d);
    startMonday.setDate(startMonday.getDate() - dayDiff);
    startMonday.setHours(2, 0, 0, 0);

    // 月曜日の深夜0:00〜1:59の送信なら、1週前の月曜2:00を起点にする
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

// 単一/複数ユーザーの24時間タイムライン生成 (1行ずつの描画)
async function generateTimelineBuffer(userData, startMs) {
    const CELL_COUNT = 288;
    const CELL_WIDTH = 3;
    const CELL_HEIGHT = 16;
    const CELL_MARGIN = 1;
    const ROW_HEIGHT = 36;
    const LABEL_WIDTH = 100;
    const PADDING = 20;

    const width = LABEL_WIDTH + (CELL_WIDTH + CELL_MARGIN) * CELL_COUNT + PADDING * 2;
    const height = PADDING * 2 + 30 + userData.length * ROW_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#949ba4';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 2) {
        const cellIndex = h * 12;
        const x = LABEL_WIDTH + PADDING + cellIndex * (CELL_WIDTH + CELL_MARGIN);
        const displayHour = (2 + h) % 24;
        ctx.fillText(`${displayHour}:00`, x, PADDING + 10);
    }

    let startY = PADDING + 30;
    ctx.textBaseline = 'middle';
    
    userData.forEach(user => {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.font = '13px sans-serif';
        ctx.fillText(user.username.slice(0, 10), LABEL_WIDTH + PADDING - 10, startY + ROW_HEIGHT / 2);

        for (let i = 0; i < CELL_COUNT; i++) {
            const cellStart = startMs + i * 5 * 60 * 1000;
            const cellEnd = cellStart + 5 * 60 * 1000;
            let cellColor = '#404249';

            for (const session of user.sessions) {
                if (session.start < cellEnd && session.end > cellStart) {
                    cellColor = session.colorHex;

                    if (session.pauses && session.pauses.length > 0) {
                        for (const pause of session.pauses) {
                            if (pause.start < cellEnd && pause.end > cellStart) {
                                cellColor = '#404249';
                                break;
                            }
                        }
                    }
                    break;
                }
            }

            const x = LABEL_WIDTH + PADDING + i * (CELL_WIDTH + CELL_MARGIN);
            const y = startY + (ROW_HEIGHT - CELL_HEIGHT) / 2;
            
            ctx.fillStyle = cellColor;
            ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
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
    const ROW_HEIGHT = 34;
    const LABEL_WIDTH = 80;
    const PADDING = 20;

    const width = LABEL_WIDTH + (CELL_WIDTH + CELL_MARGIN) * CELL_COUNT + PADDING * 2;
    const height = PADDING * 2 + 40 + DAYS.length * ROW_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`週間タイムライン: ${username}`, PADDING, PADDING + 12);

    ctx.fillStyle = '#949ba4';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 2) {
        const cellIndex = h * 12;
        const x = LABEL_WIDTH + PADDING + cellIndex * (CELL_WIDTH + CELL_MARGIN);
        const displayHour = (2 + h) % 24;
        ctx.fillText(`${displayHour}:00`, x, PADDING + 32);
    }

    let startY = PADDING + 45;
    ctx.textBaseline = 'middle';

    DAYS.forEach((dayName, dayIndex) => {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.font = '13px sans-serif';
        ctx.fillText(`${dayName}曜日`, LABEL_WIDTH + PADDING - 10, startY + ROW_HEIGHT / 2);

        const dayStartMs = startMondayMs + dayIndex * 24 * 60 * 60 * 1000;

        for (let i = 0; i < CELL_COUNT; i++) {
            const cellStart = dayStartMs + i * 5 * 60 * 1000;
            const cellEnd = cellStart + 5 * 60 * 1000;
            let cellColor = '#404249';

            for (const session of sessions) {
                if (session.start < cellEnd && session.end > cellStart) {
                    cellColor = session.colorHex;

                    if (session.pauses && session.pauses.length > 0) {
                        for (const pause of session.pauses) {
                            if (pause.start < cellEnd && pause.end > cellStart) {
                                cellColor = '#404249';
                                break;
                            }
                        }
                    }
                    break;
                }
            }

            const x = LABEL_WIDTH + PADDING + i * (CELL_WIDTH + CELL_MARGIN);
            const y = startY + (ROW_HEIGHT - CELL_HEIGHT) / 2;
            
            ctx.fillStyle = cellColor;
            ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
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
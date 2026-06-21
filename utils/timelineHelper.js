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

export function resolveSubject(colorOrName) {
    if (!colorOrName) return { hex: '#FF0000', name: 'その他' };
    
    if (colorOrName.startsWith('#')) {
        const hex = colorOrName.toUpperCase();
        return { hex: hex, name: SUBJECT_NAME[hex] || 'その他' };
    }

    const key = colorOrName.toLowerCase();
    const hex = SUBJECT_MAP[key] || '#FF0000';
    return { hex, name: SUBJECT_NAME[hex] || 'その他' };
}

export function formatTime(ms) {
    const safeMs = Math.max(0, ms);
    const totalMinutes = Math.floor(safeMs / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
}

// サーバーの場所(UTC)に依存せず、強制的に「日本時間の今日02:00 〜 翌01:59」のミリ秒を返す
export function getTodayRange() {
    const JST_OFFSET = 9 * 60 * 60 * 1000;
    const nowJstMs = Date.now() + JST_OFFSET;
    const d = new Date(nowJstMs); // 日本時間ベースの仮想Date

    const h = d.getUTCHours();

    const start = new Date(nowJstMs);
    if (h < 2) {
        start.setUTCDate(start.getUTCDate() - 1);
    }
    start.setUTCHours(2, 0, 0, 0);

    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(1, 59, 59, 999);

    return {
        startMs: start.getTime() - JST_OFFSET,
        endMs: end.getTime() - JST_OFFSET
    };
}

// 強制的に「日本時間の直近月曜02:00 〜 翌月曜01:59」のミリ秒を返す
export function getWeeklyRange() {
    const JST_OFFSET = 9 * 60 * 60 * 1000;
    const nowJstMs = Date.now() + JST_OFFSET;
    const d = new Date(nowJstMs);

    const currentDay = d.getUTCDay(); // 0:日, 1:月...
    const currentHour = d.getUTCHours();

    let dayDiff = currentDay - 1;
    if (dayDiff < 0) dayDiff = 6; // 日曜なら6日前が月曜

    const startMonday = new Date(nowJstMs);
    startMonday.setUTCDate(startMonday.getUTCDate() - dayDiff);
    startMonday.setUTCHours(2, 0, 0, 0);

    // 月曜の00:00〜01:59なら、さらに1週間前の月曜2:00にする
    if (currentDay === 1 && currentHour < 2) {
        startMonday.setUTCDate(startMonday.getUTCDate() - 7);
    }

    const endMonday = new Date(startMonday.getTime());
    endMonday.setUTCDate(endMonday.getUTCDate() + 7);
    endMonday.setUTCHours(1, 59, 59, 999);

    return {
        startMs: startMonday.getTime() - JST_OFFSET,
        endMs: endMonday.getTime() - JST_OFFSET,
        nowMs: Date.now()
    };
}
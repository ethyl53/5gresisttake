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

// 色や科目名から正しい情報に変換
function resolveSubject(colorOrName) {
    const key = colorOrName ? colorOrName.toLowerCase() : 'その他';
    const hex = SUBJECT_MAP[key] || '#FF0000';
    return { hex, name: SUBJECT_NAME[hex] || 'その他' };
}

// タイムスタンプを ○時間○分 にフォーマット
function formatTime(ms) {
    const totalMinutes = Math.floor(ms / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
}

// 今日の範囲 (02:00 〜 翌01:59) を取得
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

// 前日の範囲 (昨日の02:00 〜 今日の01:59) を取得 (2:00の集計用)
function getYesterdayRange() {
    const d = new Date();
    d.setHours(d.getHours() - 1); // 2:00実行時に確実に前日扱いにするための小技
    
    const start = new Date(d);
    if (start.getHours() < 2) start.setDate(start.getDate() - 1);
    start.setHours(2, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(1, 59, 59, 999);
    
    return { startMs: start.getTime(), endMs: end.getTime() };
}

// タイムラインPNG生成 (userData: [{ username: "表示名", sessions: [{ start, end, colorHex }] }])
async function generateTimelineBuffer(userData, startMs) {
    const CELL_COUNT = 288; // 24時間 × 12セル (5分刻み)
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

    // 背景 (Discordのダークモードに馴染む色)
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, width, height);

    // 時間ヘッダー (2:00, 4:00 ... 24:00)
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
        // ユーザー名
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.font = '13px sans-serif';
        ctx.fillText(user.username.slice(0, 10), LABEL_WIDTH + PADDING - 10, startY + ROW_HEIGHT / 2);

        // 288セルを描画
        for (let i = 0; i < CELL_COUNT; i++) {
            const cellStart = startMs + i * 5 * 60 * 1000;
            const cellEnd = cellStart + 5 * 60 * 1000;
            let cellColor = '#404249'; // 作業なし背景色

            for (const session of user.sessions) {
                if (session.start < cellEnd && session.end > cellStart) {
                    cellColor = session.colorHex;
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

    return canvas.toBuffer('image/png');
}

module.exports = {
    resolveSubject, formatTime, getTodayRange, getYesterdayRange, generateTimelineBuffer
};
/**
 * ロールテーブル処理
 * - 登録済みの表名から抽選
 * - ココフォリア形式の表を直接貼り付けて抽選
 */

const BUILT_IN_TABLES = {
    '一時的狂気表': {
        max: 10,
        entries: {
            1: '気絶あるいは金切声の発作',
            2: 'パニック状態で逃げ出す',
            3: '肉体的なヒステリー、あるいは感情の噴出(大笑い、大泣きなど)',
            4: '早口でぶつぶつ言う意味不明の会話あるいは多弁症(一貫した会話の奔流)',
            5: '探索者をその場に釘づけにしてしまうかもしれないような極度の恐怖症',
            6: '殺人癖あるいは自殺癖',
            7: '幻覚あるいは妄想',
            8: '反響動作あるいは反響言語(探索者は周りの者の動作あるいは発言を反復する)',
            9: '奇妙なもの、異様なものを食べたがる(泥、粘着物、人肉など)',
            10: '昏迷(胎児のような姿勢をとる、物事を忘れ得る)あるいは緊張症(我慢することはできるが意思も興味もない：強制的に単純な行動をとらせることはできるが、自発的に行動することはできない)'
        }
    },

    '不定の狂気表': {
        max: 10,
        entries: {
            1: '健忘症(親しい人のことを最初に忘れる:言語野肉体的な技能は働くが、知的な技能は働かない)あるいは昏迷/緊張症',
            2: '激しい恐怖症(逃げ出すことはできるが、恐怖の対象はどこへ行っても見える)',
            3: '幻覚',
            4: '奇妙な性的嗜好(露出症、過剰性欲、奇形愛好症など)',
            5: 'フェティッシュ(探索者はある物、ある種類の物、人物に対し異常なまでに執着する)',
            6: '制御不能のチック、震え、あるいは会話や文章で人と交渉することができなくなる',
            7: '心因性視覚障害、心因性難聴、単数あるいは複数の四肢の機能障害',
            8: '短時間の心因反応(支離滅裂、妄想、常軌を逸した振る舞い、幻覚など)',
            9: '一時的偏執症',
            10: '強迫観念に執りつかれた行動(手を洗い続ける、祈る、特定のリズムで歩く、割れ目をまたがない、銃を絶え間なくチェックし続けるなど)'
        }
    }
};

function makeTable(title, max, sourceEntries) {
    const entries = new Map(
        Object.entries(sourceEntries).map(([number, result]) => [
            Number(number),
            result
        ])
    );

    return { title, max, entries };
}

function parseRollTable(content) {
    if (typeof content !== 'string') return null;

    const lines = content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return null;

    // 先頭の /roll-table は省略可能
    if (/^\/roll-table(?:\s.*)?$/i.test(lines[0])) {
        lines.shift();
    }

    if (lines.length === 0) return null;

    // 登録済みの表名だけなら、その表を返す
    if (lines.length === 1 && BUILT_IN_TABLES[lines[0]]) {
        const table = BUILT_IN_TABLES[lines[0]];
        return makeTable(tableName(lines[0]), table.max, table.entries);
    }

    // ココフォリア形式の表を解析
    if (lines.length < 3) return null;

    const title = lines[0];
    const diceMatch = lines[1].match(/^1d(\d+)$/i);

    if (!diceMatch) return null;

    const max = Number(diceMatch[1]);

    if (!Number.isSafeInteger(max) || max < 1 || max > 100000) {
        return null;
    }

    const entries = {};

    for (const line of lines.slice(2)) {
        const match = line.match(/^(\d+)\s*[:：]\s*(.+)$/);

        if (!match) continue;

        const number = Number(match[1]);

        if (number < 1 || number > max) continue;

        entries[number] = match[2].trim();
    }

    if (Object.keys(entries).length < 2) return null;

    return makeTable(title, max, entries);
}

// 名前を直接指定して抽選
function rollBuiltInTable(name) {
    const table = BUILT_IN_TABLES[name];

    if (!table) return null;

    return rollTableObject(
        makeTable(name, table.max, table.entries)
    );
}

// メッセージの内容から抽選
function rollTable(content) {
    const table = parseRollTable(content);

    if (!table) return null;

    return rollTableObject(table);
}

function rollTableObject(table) {
    const roll = Math.floor(Math.random() * table.max) + 1;

    return {
        title: table.title,
        roll,
        max: table.max,
        result: table.entries.get(roll) ?? null
    };
}

// 表名を正規化する必要が生じた場合の拡張用
function tableName(name) {
    return name;
}

module.exports = {
    BUILT_IN_TABLES,
    parseRollTable,
    rollTable,
    rollBuiltInTable
};
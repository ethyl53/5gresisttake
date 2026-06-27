require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const db = require('./database/db');
const http = require('http');
const { initMonitor } = require('./utils/monitor'); // 💡 追加：統合監視システムのインポート

// 簡易ヘルスケープ用HTTPサーバー
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 8080);

// 💡 軽量化：不要な全インテントの取得をやめ、必要なインテントのみに絞り込んで負荷を激減させる
// ※ユーザー名や表示名をキャッシュから取得するため GuildMembers は必須
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// 💡 修正：不具合のあったイベント名を 'clientReady' から 正しい 'ready' に修正
client.once('ready', () => {
    console.log(`${client.user.tag} 起動`);
    
    const persistentManager = require('./scheduler/persistentRanking')(client);
    persistentManager.update(); 
    
    // 💡 修正・不整合の解消：edit.js側から問題なく呼び出せるよう、両方のプロパティ名で保持
    client.ranking = persistentManager;
    client.persistentRanking = persistentManager;
    
    require('./scheduler/ranking')(client, persistentManager);

    // 💡 追加：ボット起動時にバックグラウンド監視ループ（放置防止＆スケジュールリマインダー）を稼働
    initMonitor(client);
});

client.on('interactionCreate', async interaction => {
    // 💡 追加：DMで送られた「作業を継続する」ボタンが押されたときのインタラクション処理
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('keep_working_')) {
            const userId = interaction.customId.split('_')[2];
            
            // 安全対策: 他人がボタンのコードを偽造して押すのを防止
            if (interaction.user.id !== userId) {
                return interaction.reply({ content: 'これはあなたの確認ボタンではありません。', ephemeral: true });
            }

            try {
                const now = Date.now();
                // 警告フラグ(warned_at)を解除し、生存確認時刻(last_check)を最新に更新
                const result = await db.query(`
                    UPDATE work_sessions
                    SET last_check = $1, warned_at = NULL
                    WHERE user_id = $2 AND end_time IS NULL
                    RETURNING task_name
                `, [now, userId]);

                if (result.rowCount === 0) {
                    return interaction.update({
                        content: '⚠️ 対象の作業セッションが見つからないか、既に終了しています。',
                        components: []
                    });
                }

                // DM内のボタンを非表示化し、確認済みに更新
                await interaction.update({
                    content: `✅ **作業の継続を確認しました。**\n引き続き作業頑張ってください！`,
                    components: []
                });

            } catch (err) {
                console.error('[Keep Working Button Error]', err);
                await interaction.reply({ content: '処理中にエラーが発生しました。', ephemeral: true });
            }
        }
        return; // ボタン処理が終わったら終了
    }

    // 通常のスラッシュコマンド処理
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        
        // 💡 修正：deferReply() されている場合（interaction.deferred）も考慮し、エラー時の二次クラッシュを防ぐ
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: 'コマンドの実行中にエラーが発生しました。' }).catch(() => null);
        } else {
            await interaction.reply({ content: 'エラーが発生しました', ephemeral: true }).catch(() => null);
        }
    }
});

(async () => {
    try {
        await db.ready;
        console.log('[DB] initialization complete');
        await client.login(process.env.TOKEN);
    } catch (err) {
        console.error('[DB] failed to initialize:', err);
        process.exit(1);
    }
})();
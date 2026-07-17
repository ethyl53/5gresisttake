require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const db = require('./database/db');
const http = require('http');
const { initMonitor } = require('./utils/monitor'); // 統合監視システムのインポート

// 簡易ヘルスケープ用HTTPサーバー
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 8080);

// 軽量化：必要なインテントのみに絞り込んで負荷を激減させる
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

client.once('ready', () => {
    console.log(`${client.user.tag} 起動`);
    
    const persistentManager = require('./scheduler/persistentRanking')(client);
    persistentManager.update(); 
    
    // 💡 修正・防衛策：どのコマンドからどの名前で呼ばれても100%確実に更新が走るよう全プロパティ名を保持
    client.ranking = persistentManager;
    client.persistentRanking = persistentManager;
    client.rankingSystem = persistentManager;
    
    require('./scheduler/ranking')(client, persistentManager);

    // ボット起動時にバックグラウンド監視ループを稼働
    initMonitor(client);
});

client.on('interactionCreate', async interaction => {
    // DMで送られた「作業を継続する」ボタンが押されたときのインタラクション処理
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('keep_working_')) {
            const userId = interaction.customId.split('_')[2];
            
            if (interaction.user.id !== userId) {
                return interaction.reply({ content: 'これはあなたの確認ボタンではありません。', ephemeral: true });
            }

            try {
                const now = Date.now();
                const result = await db.query(`
                    SELECT task_name FROM activity_intervals
                    WHERE user_id = $1 AND is_active AND end_at IS NULL
                    LIMIT 1
                `, [userId]);

                if (result.rowCount === 0) {
                    return interaction.update({
                        content: '⚠️ 対象の作業セッションが見つからないか、既に終了しています。',
                        components: []
                    });
                }

                await interaction.update({
                    content: `✅ **作業の継続を確認しました。**\n引き続き作業頑張ってください！`,
                    components: []
                });

            } catch (err) {
                console.error('[Keep Working Button Error]', err);
                await interaction.reply({ content: '処理中にエラーが発生しました。', ephemeral: true });
            }
        }
        return; 
    }

    // 通常のスラッシュコマンド処理
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
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

const fs = require('fs');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

// 登録から除外するコマンド名を指定（ブラックリスト）
const BLACKLISTED_COMMANDS = ['admin-stop', 'force-update', 'schedule', 'status', 'today', 'website'];

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    
    // ブラックリストに含まれていないコマンドのみ登録
    if (command?.data?.name && !BLACKLISTED_COMMANDS.includes(command.data.name)) {
        commands.push(command.data.toJSON());
        console.log(`[Deploy] 登録対象: ${command.data.name}`);
    } else {
        console.log(`[Deploy] 登録スキップ (ブラックリスト): ${file}`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log(`コマンド登録を開始します (${commands.length}件)`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('コマンド登録完了');
    } catch (error) {
        console.error('[Deploy Error] コマンドの登録に失敗しました:', error);
    }
})();
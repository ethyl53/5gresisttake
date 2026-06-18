require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const persistentRankingInit = require('./scheduler/persistentRanking');
const rankingInit = require('./scheduler/ranking');
const db = require('./database/db');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
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
    
    // コマンドから呼べるようにセット
    client.persistentRanking = persistentManager;
    
    require('./scheduler/ranking')(client, persistentManager);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied) return;
        await interaction.reply({ content: 'エラーが発生しました', ephemeral: true });
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
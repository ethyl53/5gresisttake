const fs = require('fs');

const {
    REST,
    Routes
} = require('discord.js');

require('dotenv').config();

const commands = [];

const commandFiles =
    fs.readdirSync('./commands')
      .filter(file =>
          file.endsWith('.js')
      );

for (const file of commandFiles) {

    const command =
        require(`./commands/${file}`);

    commands.push(
        command.data.toJSON()
    );
}

const rest = new REST({
    version: '10'
}).setToken(process.env.TOKEN);

(async () => {

    await rest.put(

        Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID
        ),

        {
            body: commands
        }
    );

    console.log(
        'コマンド登録完了'
    );

})();
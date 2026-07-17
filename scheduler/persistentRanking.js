const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { intervals, aggregate, jstRange, format } = require('../utils/activityRead');
const { generateTimelineBuffer } = require('../utils/timeline');
module.exports = (client) => {
  let pending=false, running=false;
  async function update() { if (running) { pending=true; return; } running=true; try { do { pending=false; const channel=await client.channels.fetch(process.env.RANKING_CHANNEL_ID).catch(()=>null); if(!channel) return; const guildId=channel.guildId||''; const now=new Date(); const day=jstRange(); const week=jstRange(7); const [activeRows, dayRows, weekRows]=await Promise.all([intervals(db,guildId,new Date(0),new Date(Date.now()+1)),intervals(db,guildId,day.start,now),intervals(db,guildId,week.start,now)]);
    const active=activeRows.filter(r=>r.end_at===null).map(r=>`・ <@${r.user_id}> ${r.task_name||r.category_key||'未設定'}`).join('\n')||'現在作業中のユーザーはいません。';
    const daily=aggregate(dayRows,day.start,now), weekly=aggregate(weekRows,week.start,now); const rank=x=>x.map((u,i)=>`${i+1}. <@${u.userId}> **${format(u.total)}**`).join('\n')||'記録はありません。';
    const embed1=new EmbedBuilder().setTitle('現在の作業').setDescription(active).setColor(0xFFA500); const embed2=new EmbedBuilder().setTitle('今日のランキング').setDescription(rank(daily)).setColor(0x00BFFF); const embed3=new EmbedBuilder().setTitle('今週のランキング').setDescription(rank(weekly)).setColor(0x00FF7F);
    const file=daily.length?new AttachmentBuilder(await generateTimelineBuffer(daily.map(u=>({username:client.users.cache.get(u.userId)?.username||u.userId,sessions:u.sessions})),day.start.getTime()),{name:'timeline.png'}):null; if(file) embed2.setImage('attachment://timeline.png');
    const messages=await channel.messages.fetch({limit:20}); const old=messages.find(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='現在の作業'); if(old) await old.edit({embeds:[embed1,embed2,embed3],files:file?[file]:[],attachments:[]}); else await channel.send({embeds:[embed1,embed2,embed3],files:file?[file]:[]});
  } while(pending); } catch(e){console.error('[ranking update]',e);} finally{running=false;} }
  setInterval(()=>update(), 10*60*1000).unref(); return {update,resend:update};
};

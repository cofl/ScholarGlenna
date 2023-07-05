import { info, debug, error } from './util/logging.js'
import { VERSION, DISCORD_TOKEN } from './config.js'
import { Discord, GatewayDispatchEvents } from '@glenna/discord'

import { Discordv2 } from '@glenna/discord'

// import events
import { channelDeleteListener } from './events/channel-delete.js'
import { guildMemberUpdateListener } from './events/guild-member-update.js'
import { guildMemberRemoveListener } from './events/guild-member-remove.js'
import { guildUpdateListener } from './events/guild-update.js'
import { joinGuildListener } from './events/join-guild.js'
import { leaveGuildListener } from './events/leave-guild.js'
import { readyListener } from './events/ready.js'
import { roleUpdateListener } from './events/role-update.js'
import { userUpdateListener } from './events/user-update.js'
import { onCommandListener } from './events/on-command.js'

import { REST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import { Client, GatewayIntentBits } from '@discordjs/core'

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN)
const gateway = new WebSocketManager({
    token: DISCORD_TOKEN,
    rest,
    intents: 0
        | GatewayIntentBits.Guilds
        | GatewayIntentBits.GuildMembers
        | GatewayIntentBits.GuildMessages
        | GatewayIntentBits.GuildMessageReactions
})
export const Glenna = new Client({ rest, gateway })

debug("Registering events...")
channelDeleteListener.register(Glenna)
guildMemberUpdateListener.register(Glenna)
guildMemberRemoveListener.register(Glenna)
guildUpdateListener.register(Glenna)
joinGuildListener.register(Glenna)
leaveGuildListener.register(Glenna)
onCommandListener.register(Glenna)
readyListener.register(Glenna)
roleUpdateListener.register(Glenna)
userUpdateListener.register(Glenna)

export async function login(): Promise<void> {
    try {
        debug(`Connecting to gateway...`)
        void await gateway.connect()
        debug(`Connection successful.`)
        info(`GlennaBot v${VERSION} logged in.`)
    } catch(err){
        error(err)
        return
    }
}

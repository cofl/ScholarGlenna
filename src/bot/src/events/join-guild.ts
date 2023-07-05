import { listener } from '../EventListener.js'
import { registerCommands } from '../commands/index.js'
import { DISCORD_TOKEN, OAUTH_CLIENT_ID } from '../config.js'
import { Logger } from '../util/logging.js'
import { database } from '../util/database.js'
import { sendWelcomeMessage } from '../util/guild.js'
import { GatewayDispatchEvents } from '@glenna/discord'
import type { Guild } from '@discordjs/core'

export const joinGuildListener = listener(GatewayDispatchEvents.GuildCreate, {
    async execute(event){
        const { shardId, data: guild } = event
        const logger = Logger.get(shardId, { origin: 'Event', event: GatewayDispatchEvents.GuildCreate })
        logger.notice({ target: { name: guild.name, id: guild.id }, message: "Joining guild." })
        await database.guild.import(guild)

        logger.info({ target: { name: guild.name, id: guild.id }, message: "Registering commands." })
        await registerCommands({
            token: DISCORD_TOKEN,
            clientId: OAUTH_CLIENT_ID,
            guildId: guild.id
        })

        logger.info({ target: { name: guild.name, id: guild.id }, message: "Sending welcome message." })
        debug(`Sending welcome message.`)
        await sendWelcomeMessage(guild)
    }
})

import { GatewayDispatchEvents } from '@glenna/discord'
import { listener } from '../EventListener.js'
import { database } from '../util/database.js'
import { Logger } from '../util/logging.js'

export const leaveGuildListener = listener(GatewayDispatchEvents.GuildDelete, {
    async execute({ shardId, data: guild }){
        const logger = Logger.get(shardId, { origin: 'Event', event: GatewayDispatchEvents.GuildDelete })
        if(guild.unavailable){
            logger.notice({ target: guild.id, message: "Skipping Guild Delete event (lost contact due to outage)." })
            return
        }

        logger.notice({ target: guild.id, message: "Leaving guild." })
        const snowflake = BigInt(guild.id)
        await database.guild.update({
            where: { snowflake },
            data: { lostRemoteReferenceAt: new Date() }
        })
    }
})

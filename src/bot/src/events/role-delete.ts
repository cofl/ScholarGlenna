import { GatewayDispatchEvents } from '@discordjs/core'
import { listener } from '../EventListener.js'
import { database } from '../util/database.js'
import { Logger } from '../util/logging.js'

export default listener(GatewayDispatchEvents.GuildRoleDelete, {
    async execute({ shardId, data: role }){
        const logger = Logger.get(shardId, { origin: 'Event', event: GatewayDispatchEvents.GuildRoleDelete })
        const result = await database.team.updateMany({
            where: {
                guild: { snowflake: BigInt(role.guild_id) },
                role: BigInt(role.role_id)
            },
            data: { role: null },
        })
        logger.info({ target: role, message: `Cleared ${result.count} associations with deleted role.` })
    }
})

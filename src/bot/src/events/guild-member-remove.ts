import { debug } from '../util/logging.js'
import { database } from '../util/database.js'
import { listener } from '../EventListener.js'
import { GatewayDispatchEvents } from '@glenna/discord'

export const guildMemberRemoveListener = listener(GatewayDispatchEvents.GuildMemberRemove, {
    async execute({ data: member }){
        const user = await database.guildMember.findFirst({
            where: {
                user: { snowflake: BigInt(member.user.id) },
                guild: { snowflake: BigInt(member.guild_id) }
            },
            select: {
                id: true,
                name: true,
                user: {
                    select: {
                        name: true
                    }
                }
            }
        })

        if(!user){
            debug(`Target user was not in database.`)
            return
        }
        await database.guildMember.update({
            where: { id: user.id },
            data: { lostRemoteReferenceAt: new Date() }
        })

        const name = user.name ?? user.user.name
        // TODO: notify that ${name} left the server.
    }
})

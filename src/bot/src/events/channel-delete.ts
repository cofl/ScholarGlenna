import { GatewayDispatchEvents } from '@glenna/discord'
import { listener } from '../EventListener.js'
import { database } from '../util/database.js'

export const channelDeleteListener = listener(GatewayDispatchEvents.ChannelDelete, {
    async execute(channel){
        await database.team.updateMany({
            where: { channel: BigInt(channel.data.id) },
            data: { channel: null }
        })
    }
})

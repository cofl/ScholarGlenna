import { REST as DiscordREST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import {
    API,
    Client as DiscordClient,
    GatewayIntentBits,
    type ClientOptions,
} from '@discordjs/core'
import { getConfig } from './config'

export namespace Discord {
    export const BotToken = () => getConfig().DISCORD_TOKEN
    export const UserREST = (token: string) => new DiscordREST({ version: '10', authPrefix: 'Bearer' }).setToken(token)
    export const BotREST = (token: string) => new DiscordREST({ version: '10' }).setToken(token)

    export const Gateway = (token: string, rest?: DiscordREST) => new WebSocketManager({
        token, rest: rest ?? BotREST(token),
        intents: 0
            | GatewayIntentBits.Guilds
            | GatewayIntentBits.GuildMembers
            | GatewayIntentBits.GuildMessages
            | GatewayIntentBits.GuildMessageReactions
    })

    export const LiveClient = (options: ClientOptions) => new DiscordClient(options)
    export const APIClient = (rest: DiscordREST) => new API(rest)
}

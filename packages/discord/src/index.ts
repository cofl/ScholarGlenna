import {
    Client,
    IntentsBitField,
    REST,
    CDN,
} from 'discord.js'
import { getConfig } from './config.js'

export const API_BASE_URI = `https://discord.com/api/v10`
export * from 'discord.js'
export namespace Discord {
    export function createClient(): Client {
        return new Client({
            intents: [
                IntentsBitField.Flags.Guilds,
                IntentsBitField.Flags.GuildMembers,
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.GuildMessageReactions,
                //IntentsBitField.Flags.GuildPresences,
            ]
        })
    }

    export async function login(client: Client){
        const { DISCORD_TOKEN } = getConfig()
        await client.login(DISCORD_TOKEN)
    }

    export namespace Rest {
        export function createUserClient(token: string): REST {
            return new REST({
                version: '10',
                authPrefix: 'Bearer',
            }).setToken(token)
        }

        let instance: REST | null = null
        export function getBotClient(): REST {
            return instance ??= new REST({
                version: '10'
            }).setToken(getConfig().DISCORD_TOKEN)
        }
    }
}

export const DiscordCDN = new CDN()
export { Discord as Discordv2 } from './v2.js'

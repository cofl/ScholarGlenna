import { z } from 'zod'
import { database } from '../../../util/database.js'
import { subcommand } from '../../_command.js'
import { djs } from '../../_djs.js'
import { EmbedBuilder } from '@glenna/discord'

export const list = subcommand({
    description: `Fetch a team's members.`,
    input: z.object({
        team: djs.string(b => b.setAutocomplete(true)).describe('The team to fetch times for.'),
        guild: djs.guild().transform(database.guild.transformOrThrow({ id: true })),
    }),
    async execute({ team: teamName, guild }){
        const team = await database.team.findUniqueOrThrow({
            where: { guildId_alias: { guildId: guild.id, alias: teamName }},
            select: {
                type: true,
                mention: true,
                times: {
                    select: {
                        id: true,
                        computed: {
                            select: {
                                timeCode: true
                            }
                        }
                    }
                }
            }
        })

        const times = team.times.map(({ id, computed: { timeCode }}) => `(${id}) ${timeCode()}`)

        return {
            embeds: [
                new EmbedBuilder({
                    color: 0x40a86d,
                    title: `Team ${team.mention}`,
                    fields: [
                        {
                            name: 'Times',
                            value: times.length > 0 ? times.map(a => `- ${a}`).join(`\n`) : `*Use \`/team time add\` to add run times to this team.*`
                        }
                    ]
                })
            ]
        }
    },
    async autocomplete({ name, value }, interaction){
        if(name === 'team')
            return await database.team.autocomplete(BigInt(interaction.guild!.id), value)

        return
    }
})

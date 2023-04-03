import { z } from 'zod'
import { database } from '../../../util/database.js'
import { subcommand } from '../../_command.js'
import { djs } from '../../_djs.js'
import { debug } from '../../../util/logging.js'
import { EmbedBuilder } from '@glenna/discord'
import { PublicError } from '../../../PublicError.js'

export const remove = subcommand({
    description: 'Remove a member from a team.',
    input: z.object({
        team: djs.string(b => b.setAutocomplete(true)).describe('The team to modify.'),
        member: djs.index().describe('The member to remove.'),
        guild: djs.guild().transform(database.guild.transformOrThrow({ id: true })),
        actor: djs.actor(),
    }),
    async authorize({ guild, actor, team: alias }){
        const team = await database.team.findUnique({
            where: { guildId_alias: { guildId: guild.id, alias }},
            select: { type: true }
        })
        return database.isAuthorized(guild, BigInt(actor.id), {
            // only management team captains can modify the roster of management teams
            role: team?.type === 'Management' ? 'Captain' : undefined,
            team: { type: 'Management' }
        })
    },
    async execute({ team: teamName, member, guild }){
        const team = await database.team.findUniqueOrThrow({
            where: { guildId_alias: { guildId: guild.id, alias: teamName }},
            select: {
                id: true,
                name: true,
                role: true,
                mention: true
            }
        })

        if(team.role !== null)
            throw new PublicError(`Cannot remove members from ${team.mention} because it is using role synchronization.`)

        const teamMember = await database.teamMember.findFirstOrThrow({
            where: { id: member },
            select: {
                id: true,
                team: { select: { id: true }},
                computed: { select: { displayName: true }},
                member: { select: { snowflake: true }}
            }
        })
        if(teamMember.team.id !== team.id)
            throw new PublicError(`Member is not part of team.`)
        await database.teamMember.delete({ where: { id: teamMember.id }})
        debug(`Removed ${teamMember.computed.displayName} from team ${team.name} (${team.id}).`)

        return {
            embeds: [
                new EmbedBuilder({
                    color: 0x40a86d,
                    title: `Team ${team.name} Member Removed`,
                    fields: [
                        {
                            name: 'Removed Member',
                            value: `<@${teamMember.member.snowflake}>`
                        }
                    ]
                })
            ]
        }
    },
    async autocomplete({ name, value }, interaction){
        if(name === 'team')
            return await database.team.autocomplete(BigInt(interaction.guild!.id), value, { member: BigInt(interaction.user.id), orManager: true })
        if(name === 'member')
            return await database.teamMember.autocomplete(BigInt(interaction.guild!.id), interaction.options.getString('team'), value, BigInt(interaction.user.id))

        return
    }
})

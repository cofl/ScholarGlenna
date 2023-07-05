import { database } from '../util/database.js'
import { debug } from '../util/logging.js'
import { listener } from '../EventListener.js'
import { safeUsername, type Prisma, safeAlias } from '@glenna/prisma'
import { GatewayDispatchEvents } from '@glenna/discord'

export const guildMemberUpdateListener = listener(GatewayDispatchEvents.GuildMemberUpdate, {
    async execute(oldMember, newMember){
        if(newMember.user.id === newMember.client.user?.id){
            debug(`Skipping user update for ScholarGlenna bot.`)
            return
        }

        const removedRoles = oldMember.roles.cache.filter((_, role) => !newMember.roles.cache.has(role))
        const addedRoles = newMember.roles.cache.filter((_, role) => !oldMember.roles.cache.has(role))

        const guild = { snowflake: BigInt(newMember.guild.id) }
        const teamRoles = new Map(await database.team.findMany({
            where: {
                guild,
                role: {
                    in: Array.from(new Set([ ...removedRoles.keys(), ...addedRoles.keys() ]), a => BigInt(a))
                }
            },
            select: {
                id: true,
                role: true
            }
        }).then(results => results.map(({ id, role }) => [ role!.toString(), id! ])))

        const removedTeams: number[] = Array.from(removedRoles.filter((_, k) => teamRoles.has(k)).map((_, k) => teamRoles.get(k)!))
        const addedTeams: Prisma.TeamMemberCreateManyMemberInput[] = Array.from(
            addedRoles.filter((_, k) => teamRoles.has(k)).map((_, k) => teamRoles.get(k)!),
            teamId => ({ teamId, role: 'Member' }))

        const snowflake = BigInt(newMember.user.id)
        let currentUser = await database.user.findUnique({
            where: { snowflake },
            select: {
                id: true,
                guildMemberships: {
                    where: { guild },
                    select: {
                        id: true,
                        name: true,
                        icon: true,
                        lostRemoteReferenceAt: true,
                    }
                }
            }
        })
        if(!currentUser){
            if(addedTeams.length === 0){
                debug(`Skipping update for user not in database.`)
                return
            }

            debug(`Creating user (added to guild team).`)
            currentUser = await database.user.create({
                data: {
                    snowflake,
                    name: safeUsername(newMember.user),
                    alias: safeAlias(newMember.user),
                    icon: newMember.user.avatar,
                },
                select: {
                    id: true,
                    guildMemberships: {
                        where: { guild },
                        select: {
                            id: true,
                            name: true,
                            icon: true,
                            lostRemoteReferenceAt: true,
                        }
                    }
                }
            })
        }

        let [ currentMember ] = currentUser.guildMemberships
        if(!currentMember){
            if(addedTeams.length === 0){
                debug(`Skipping update for member not in database.`)
                return
            }

            debug(`Creating guild member (added to guild team).`)
            currentMember = await database.guildMember.create({
                data: {
                    snowflake,
                    name: newMember.nickname,
                    icon: newMember.avatar,
                    guild: { connect: guild },
                    user: { connect: { id: currentUser.id }}
                },
                select: {
                    id: true,
                    name: true,
                    icon: true,
                    lostRemoteReferenceAt: true,
                }
            })
        }

        const data: Prisma.GuildMemberUpdateInput = {}
        if(currentMember.name !== newMember.nickname)
            data.name = newMember.nickname
        if(currentMember.icon !== newMember.avatar)
            data.icon = newMember.avatar
        if(currentMember.lostRemoteReferenceAt !== null)
            data.lostRemoteReferenceAt = null

        if(removedTeams.length > 0){
            data.teamMemberships ??= {}
            data.teamMemberships.deleteMany = { teamId: { in: removedTeams }}
        }

        if(addedTeams.length > 0){
            data.teamMemberships ??= {}
            data.teamMemberships.createMany = { data: addedTeams }
        }
        if(Object.keys(data).length > 0){
            debug(`User updated (${newMember.displayName} -- ${newMember.id}): ${JSON.stringify(data)}`)
            await database.guildMember.update({ where: { id: currentMember.id }, data })
        }
    }
})

import type { User as DiscordUser } from 'discord.js'
import type { Prisma, User } from '../../generated/client'
import type { Transactionable } from './Client.js'
import type { Database } from '.'

type UpdateUserInfo = null | Pick<User, 'user_id' | 'username' | 'discriminator'>
export class Users {
    #database: Database
    constructor(database: Database){ this.#database = database }
    async upsert(source: DiscordUser, target: UpdateUserInfo, options?: Transactionable): Promise<User> {
        const db = options?.client ?? this.#database.Client
        const data = {} as Prisma.UserCreateInput & Prisma.UserUpdateInput
        if(target?.username !== source.username)
            data.username = source.username
        const discriminator = Number.parseInt(source.discriminator)
        if(target?.discriminator !== discriminator)
            data.discriminator = discriminator
        const update = { ...data }
        if(target && Object.keys(data).length > 0)
            update.updated_at = new Date()
        const snowflake = BigInt(source.id)
        return await db.user.upsert({ where: { snowflake }, update, create: {
            snowflake,
            username: source.username,
            discriminator: Number.parseInt(source.discriminator)
        }})
    }

    async prune(options?: Transactionable){
        const db = options?.client ?? this.#database.Client
        await db.$executeRaw`
            delete from
                Users
            using
                UserReferenceCount
            where
                Users.user_id = UserReferenceCount.user_id
                and UserReferenceCount.Count = 0;
        `
    }
}

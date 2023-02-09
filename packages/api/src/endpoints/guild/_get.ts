import { z } from 'zod'
import { procedure } from '../../trpc.js'
import { database } from "../../database.js"
import { stringifySnowflake } from '@glenna/prisma'

export const getProcedure = procedure
    .input(z.object({
        guild: database.guild.fetch('guild', {
            snowflake: true,
            name: true,
            alias: true
        })
    }))
    .query(({ input: { guild }}) => stringifySnowflake(guild))

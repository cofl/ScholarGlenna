import type { RequestHandler } from '@sveltejs/kit'
import { AppDataSource } from '@glenna/common'
import { notFound } from '$lib/status'

type Relate<K extends keyof Class> = { [key in K]?: ClassQuery<key> }
type ClassQuery<K extends keyof Class> = { props: (keyof Class[K]['props'])[] } & Omit<Class[K], 'props'>
interface Class {
    guilds: {
        props: {
            name: string
            alias: string
        }
    } & Relate<'teams'>
    teams: {
        props: {
            name: string
            alias: string
        }
    }
}
type Query = Relate<keyof Class>
namespace Database { export async function query(_: Query): Promise<null> { return null } }
export const get: RequestHandler = async event => {
    const user = event.locals.user ?? false
    const alias = event.params['id']
    if(!alias)
        return notFound()
    const data = await Database.query({
        guilds: {
            props: [ 'name', 'alias' ],
            teams: {
                props: [ 'name', 'alias' ]
            }
        }
    })
    const { Guilds } = await AppDataSource
    const guild = await Guilds.lookup(alias)
    if(!guild)
        return notFound()
    return {
        status: 200,
        body: {
            user,
            guild: guild.json(),
            teams: []
        }
    }
}

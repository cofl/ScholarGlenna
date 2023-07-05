import type { ManagerShardEventsMap, Client } from '@discordjs/core'

export type EventListener<K extends keyof ManagerShardEventsMap = keyof ManagerShardEventsMap> = {
    event: K
    once?: boolean
    execute(...args: ManagerShardEventsMap[K]): void | Promise<void>,
    register(client: Client): void
}

export function listener<K extends keyof ManagerShardEventsMap>(event: K, { once, execute }: Pick<EventListener<K>, "once" | "execute">): EventListener<K> {
    return {
        event,
        execute,
        once,
        register(client: Client){
            if(this.once)
                client.once(this.event, this.execute)
            else
                client.on(this.event, this.execute)
        }
    }
}

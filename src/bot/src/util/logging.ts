import { createLogger, format, transports } from 'winston'

const errorFormat = format(info => {
    if(info instanceof Error){
        Object.assign({}, info, { message: info.stack })
    }
    return info
})

export namespace Logger {
    export const _default = createLogger({
        levels: {
            emergency: 0,
            alert: 1,
            error: 2,
            warn: 3,
            notice: 4,
            info: 5,
            debug: 6
        },
        level: 'debug',
        format: format.combine(
            errorFormat(),
            format.colorize(),
            format.splat(),
            format.printf(({ level, message }) => `${level}: ${message}`)
        ),
        transports: [
            new transports.Console({ level: 'debug' })
        ]
    })

    let sequence = 0
    let lastMillisecond = 0
    const snowflakeEpoch = new Date("2012-08-28 00:00:00+00Z").valueOf()
    export function snowflake(shardId: number){
        const entryTime = Date.now()
        while(sequence === 4095 && Date.now() <= entryTime); // spinlock while we're out of IDs
        const now = Date.now()
        if(lastMillisecond === now)
            sequence += 1
        else
            sequence = 0
        lastMillisecond = now
        const timestamp = BigInt(now - snowflakeEpoch) << 22n
        return timestamp | BigInt((shardId & 0x1F << 10) + sequence)
    }

    type ChildLoggerOptions =
        { origin: 'Event', event: string }
    export function get(shardId: number, meta: ChildLoggerOptions){
        return _default.child({
            ...meta,
            shardId,
            request: snowflake(shardId)
        })
    }
}

import { SlashCommandBuilder } from '@discordjs/builders'
import type { ChatInputCommandInteraction } from 'discord.js'
import { SlashCommand, SlashSubcommand } from '../SlashCommand.js'
import { load } from '@glenna/util'

const data = new SlashCommandBuilder()
    .setName('glenna')
    .setDescription('General info and management.')
const subcommands = new Map<string, SlashSubcommand>()
for(const subcommand of await load<SlashSubcommand>(import.meta, './glenna')){
    data.addSubcommand(builder => subcommand.builder(builder).setName(subcommand.name))
    subcommands.set(subcommand.name, subcommand)
}

async function error(interaction: ChatInputCommandInteraction){
    await interaction.reply({
        ephemeral: true,
        content: "Unrecognized subcommand."
    })
}

export default new SlashCommand({
    data,
    async execute(interaction){
        const subcommand = interaction.options.getSubcommand()
        if(!subcommand)
            return await error(interaction)
        const exec = subcommands.get(subcommand)
        if(!exec)
            return await error(interaction)
        await exec.execute(interaction)
    }
})

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { LANES } = require('./lane-roles');
const { LOL_TIERS } = require('./ladder');

const tierChoices = LOL_TIERS.map(tier => ({ name: tier.charAt(0) + tier.slice(1).toLowerCase(), value: tier }));
const laneChoices = [...Object.values(LANES).map(lane => ({ name: lane.label, value: lane.id })), { name: 'Any lane', value: 'ANY' }];

// Shared by deploy-commands.js (registration) and index.js (dispatch).
const COMMANDS = [
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Show a League and VALORANT rank card')
        .addUserOption(option => option.setName('user').setDescription('Whose profile (default: you)')),
    new SlashCommandBuilder()
        .setName('mastery')
        .setDescription('Champion and agent mastery')
        .addSubcommand(sub => sub.setName('player').setDescription('Top champions and agents for a player')
            .addUserOption(option => option.setName('user').setDescription('Whose mastery (default: you)')))
        .addSubcommand(sub => sub.setName('server').setDescription('Most played champions across the server')),
    new SlashCommandBuilder()
        .setName('inhouse')
        .setDescription('Start an inhouse lobby with rank-balanced teams')
        .addIntegerOption(option => option.setName('team_size').setDescription('Players per team (default 5)').setMinValue(1).setMaxValue(5)),
    new SlashCommandBuilder()
        .setName('lfg')
        .setDescription('Find a duo partner')
        .addStringOption(option => option.setName('lane').setDescription('Lane you are looking for').setRequired(true).addChoices(...laneChoices))
        .addStringOption(option => option.setName('min_rank').setDescription('Lowest rank').addChoices(...tierChoices))
        .addStringOption(option => option.setName('max_rank').setDescription('Highest rank').addChoices(...tierChoices))
        .addStringOption(option => option.setName('note').setDescription('Anything else (e.g. "chill, mic on")').setMaxLength(100)),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Bot health: uptime, refreshes, API errors, database')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('welcome-preview')
        .setDescription('Preview the welcome message new members receive')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.setDMPermission(false).toJSON());

module.exports = { COMMANDS };

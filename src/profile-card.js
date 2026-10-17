const path = require('node:path');
const fs = require('node:fs');
const axios = require('axios');
const { EmbedBuilder, AttachmentBuilder, escapeMarkdown } = require('discord.js');
const { leagueLabel, leagueEmblemUrl, valorantRankIconUrl, progressBar, APEX_TIERS } = require('./ladder');
const { LANES } = require('./lane-roles');
const { VALORANT_AGENT_ROLES } = require('./valorant-roles');

// @napi-rs/canvas is an optional dependency: if it failed to install on the host,
// /profile still works and sends an embed instead of an image.
let canvas = null;
try {
    canvas = require('@napi-rs/canvas');
    const fontDir = path.join(__dirname, 'assets', 'fonts');
    if (fs.existsSync(fontDir)) {
        for (const file of fs.readdirSync(fontDir).filter(name => /\.(ttf|otf)$/i.test(name))) {
            canvas.GlobalFonts.registerFromPath(path.join(fontDir, file), 'CardFont');
        }
    }
} catch {
    canvas = null;
}

// Without any font the text would render invisibly, so only draw when one exists.
function canDraw() {
    return Boolean(canvas) && canvas.GlobalFonts.families.length > 0;
}

// A bundled font wins; otherwise the first clean sans-serif the host has
// (Windows: Segoe UI, Linux hosts: usually DejaVu / Liberation / Noto).
const PREFERRED_FONTS = ['CardFont', 'Segoe UI', 'Inter', 'Roboto', 'Noto Sans', 'DejaVu Sans', 'Liberation Sans', 'Arial', 'Helvetica'];
function fontFamily() {
    const found = PREFERRED_FONTS.find(name => canvas.GlobalFonts.has(name));
    return found ? `"${found}"` : 'sans-serif';
}

// Rank emblems ship with lots of transparent padding (League's are 2560x1440 with
// the art in the middle fifth), so each image is trimmed to its visible pixels.
// Results are cached: the same few emblems are drawn on every card.
const imageCache = new Map();
function visibleBounds(image) {
    const scale = Math.min(1, 256 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const probe = canvas.createCanvas(width, height).getContext('2d');
    probe.drawImage(image, 0, 0, width, height);
    const pixels = probe.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3] > 20) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < 0) return { sx: 0, sy: 0, sw: image.width, sh: image.height };
    return { sx: left / scale, sy: top / scale, sw: (right - left + 1) / scale, sh: (bottom - top + 1) / scale };
}

async function loadRemoteImage(url, { trim = false } = {}) {
    if (!url) return null;
    const key = `${trim}:${url}`;
    if (imageCache.has(key)) return imageCache.get(key);
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        const image = await canvas.loadImage(Buffer.from(response.data));
        const entry = { image, bounds: trim ? visibleBounds(image) : { sx: 0, sy: 0, sw: image.width, sh: image.height } };
        if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
        imageCache.set(key, entry);
        return entry;
    } catch {
        return null;
    }
}

// Draws the image's visible part centred in a size×size box, keeping its aspect ratio.
function drawFitted(ctx, { image, bounds }, x, y, size) {
    const ratio = Math.min(size / bounds.sw, size / bounds.sh);
    const width = bounds.sw * ratio, height = bounds.sh * ratio;
    ctx.drawImage(image, bounds.sx, bounds.sy, bounds.sw, bounds.sh, x + (size - width) / 2, y + (size - height) / 2, width, height);
}

function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

function winRate(wins, games) {
    return games ? `${((wins / games) * 100).toFixed(1)}% WR • ${games} games` : 'No games yet';
}

function leagueSummary(lol) {
    if (!lol) return null;
    const ranked = lol.tier && lol.tier !== 'UNRANKED';
    return {
        game: 'LEAGUE OF LEGENDS',
        accent: '#C8AA6E',
        rank: ranked ? leagueLabel(lol.tier, lol.rank) : 'Unranked',
        points: ranked ? `${lol.league_points} LP` : '',
        progress: ranked && !APEX_TIERS.has(lol.tier) ? lol.league_points / 100 : null,
        record: winRate(lol.wins, lol.wins + lol.losses),
        extra: lol.lane && LANES[lol.lane] ? `Main lane: ${LANES[lol.lane].label}` : 'No lane selected',
        icon: ranked ? leagueEmblemUrl(lol.tier) : null,
        account: `${lol.riot_id}#${lol.tag}`
    };
}

function valorantSummary(val) {
    if (!val) return null;
    const ranked = val.current_tier >= 3;
    return {
        game: 'VALORANT',
        accent: '#FD4556',
        rank: ranked ? val.tier_name : 'Unrated',
        points: ranked ? `${val.ranking_in_tier} RR` : '',
        progress: ranked && !/radiant/i.test(val.tier_name) ? val.ranking_in_tier / 100 : null,
        record: winRate(val.wins, val.number_of_games),
        extra: val.agent_role && VALORANT_AGENT_ROLES[val.agent_role] ? `Main role: ${VALORANT_AGENT_ROLES[val.agent_role].label}` : 'No agent role selected',
        icon: valorantRankIconUrl(val.current_tier),
        account: `${val.riot_id}#${val.tag}`
    };
}

async function drawPanel(ctx, x, y, width, height, summary) {
    const font = fontFamily();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundedRect(ctx, x, y, width, height, 18);
    ctx.fill();
    ctx.fillStyle = summary?.accent || '#555';
    roundedRect(ctx, x, y, 6, height, 3);
    ctx.fill();

    if (!summary) {
        ctx.fillStyle = '#8b97a7';
        ctx.font = `20px ${font}`;
        ctx.fillText('Not linked', x + 28, y + height / 2 + 7);
        return;
    }
    const icon = await loadRemoteImage(summary.icon, { trim: true });
    const textX = icon ? x + 150 : x + 28;
    if (icon) drawFitted(ctx, icon, x + 24, y + (height - 110) / 2, 110);

    ctx.fillStyle = summary.accent;
    ctx.font = `bold 15px ${font}`;
    ctx.fillText(summary.game, textX, y + 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 30px ${font}`;
    ctx.fillText(summary.rank, textX, y + 72);
    ctx.font = `20px ${font}`;
    ctx.fillStyle = '#d6dde6';
    ctx.fillText(summary.points, textX, y + 102);

    if (summary.progress !== null) {
        const barX = textX + 90, barY = y + 88, barWidth = width - (barX - x) - 24;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundedRect(ctx, barX, barY, barWidth, 12, 6);
        ctx.fill();
        ctx.fillStyle = summary.accent;
        roundedRect(ctx, barX, barY, Math.max(12, barWidth * Math.min(1, summary.progress)), 12, 6);
        ctx.fill();
    }
    ctx.fillStyle = '#9fb0c3';
    ctx.font = `16px ${font}`;
    ctx.fillText(summary.record, textX, y + 132);
    ctx.fillText(summary.extra, textX, y + 156);
}

async function renderCard({ user, displayName, lol, val }) {
    const width = 900, height = 360;
    const image = canvas.createCanvas(width, height);
    const ctx = image.getContext('2d');
    const font = fontFamily();

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#0f1923');
    background.addColorStop(1, '#1f2b3d');
    ctx.fillStyle = background;
    roundedRect(ctx, 0, 0, width, height, 24);
    ctx.fill();

    const avatar = await loadRemoteImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
    ctx.save();
    ctx.beginPath();
    ctx.arc(95, 85, 55, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) {
        drawFitted(ctx, avatar, 40, 30, 110);
    } else {
        ctx.fillStyle = '#5865F2';
        ctx.fillRect(40, 30, 110, 110);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 52px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText((displayName.trim()[0] || '?').toUpperCase(), 95, 103);
        ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(95, 85, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 38px ${font}`;
    ctx.fillText(displayName.slice(0, 28), 175, 82);
    ctx.fillStyle = '#8b97a7';
    ctx.font = `18px ${font}`;
    ctx.fillText([lol?.account, val?.account].filter(Boolean).join('   •   ').slice(0, 70), 175, 114);

    await drawPanel(ctx, 30, 170, 410, 170, lol);
    await drawPanel(ctx, 460, 170, 410, 170, val);
    return image.encode('png');
}

function buildProfileEmbed({ user, displayName, lol, val }) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: displayName, iconURL: user.displayAvatarURL() })
        .setTitle('🪪 Player Profile');
    for (const summary of [lol, val]) {
        if (!summary) continue;
        const bar = summary.progress !== null ? ` ${progressBar(summary.progress * 100, 100, 8)}` : '';
        embed.addFields({
            name: summary.game === 'VALORANT' ? '🔴 VALORANT' : '⚔️ League of Legends',
            value: `**${summary.rank}** ${summary.points}${bar}\n${summary.record}\n${summary.extra}\n\`${escapeMarkdown(summary.account)}\``,
            inline: true
        });
    }
    const icon = lol?.icon || val?.icon;
    if (icon) embed.setThumbnail(icon);
    return embed;
}

async function handleProfileCommand(interaction, db) {
    const user = interaction.options.getUser('user') || interaction.user;
    await interaction.deferReply();
    const [lolRow, valRow] = await Promise.all([
        db.prepare('SELECT * FROM players WHERE discord_id = ?').get(user.id),
        db.prepare('SELECT * FROM valorant_players WHERE discord_id = ?').get(user.id)
    ]);
    if (!lolRow && !valRow) {
        await interaction.editReply(`${user.id === interaction.user.id ? 'You have' : `<@${user.id}> has`} not linked a League or VALORANT account yet.`);
        return;
    }
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
    const data = { user, displayName: member?.displayName || user.globalName || user.username, lol: leagueSummary(lolRow), val: valorantSummary(valRow) };
    if (canDraw()) {
        try {
            const png = await renderCard(data);
            await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'profile.png' })], allowedMentions: { parse: [] } });
            return;
        } catch (error) {
            console.error('[Profile] Card render failed; sending embed instead:', error.message);
        }
    }
    await interaction.editReply({ embeds: [buildProfileEmbed(data)], allowedMentions: { parse: [] } });
}

module.exports = { handleProfileCommand, leagueSummary, valorantSummary, buildProfileEmbed, renderCard, canDraw };


try { require('os').setPriority(process.pid, -20); } catch { }

import tls from 'tls';
import http2 from 'http2';
import WebSocket from 'ws';
import extractJsonFromString from 'extract-json-from-string';
import axios from 'axios';
import https from 'https';
import chalk from 'chalk';
import { Client } from 'discord.js-selfbot-v13';

// ═══════════════════════════════════════════════════════════════
// Conf
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
    token: 'TOKEN_BURAYA',
    sifre: 'SIFRE_BURAYA',
    hedefGuildId: 'GUILD_ID_BURAYA',
    yasaklamaSebebi: 'YASAKLAMA_SEBEBI_BURAYA',
    bildirimKanalId: 'KANAL_ID_BURAYA'  // Selfbot bildirim kanalı
};

const zaman = () => new Date().toLocaleTimeString();
const log = (...args) => console.log(chalk.yellow(`[${zaman()}][LOG]`), ...args);
const hata = (...args) => console.error(chalk.red(`[${zaman()}][ERROR]`), ...args);
const info = (...args) => console.log(chalk.cyan(`[${zaman()}][INFO]`), ...args);
const basari = (...args) => console.log(chalk.bgGreen.black(`[${zaman()}][SUCCESS]`), ...args);
const koruma = (...args) => console.log(chalk.bgBlue.white(`[${zaman()}][KORUMA]`), ...args);

let mfaJetonu = null;
let korunanVanityUrl = null;

const selfbotClient = new Client();
let selfbotReady = false;

selfbotClient.on('ready', () => {
    selfbotReady = true;
    info(`Selfbot hazır: ${selfbotClient.user.tag}`);
});

selfbotClient.login(CONFIG.token).catch((err) => {
    hata('Selfbot giriş başarısız:', err.message);
});

async function bildirimGonder(mesaj) {
    if (!selfbotClient || !selfbotReady) return;

    try {
        const kanal = selfbotClient.channels.cache.get(CONFIG.bildirimKanalId);
        if (kanal) {
            await kanal.send(mesaj);
        }
    } catch (err) {
        hata('Bildirim gönderilemedi:', err.message);
    }
}

async function acilisBildirimi() {
    const mesaj =
        `\`\`\`\n` +
        `═══════════════════════════════════════\n` +
        `          Self Vanity Guard\n` +
        `═══════════════════════════════════════\n` +
        `  Guild ID: ${CONFIG.hedefGuildId}\n` +
        `  Korunan URL: ${korunanVanityUrl || 'Bekleniyor...'}\n` +
        `  Zaman: ${new Date().toLocaleString('tr-TR')}\n` +
        `═══════════════════════════════════════\n` +
        `\`\`\``;
    await bildirimGonder(mesaj);
}

async function urlGeriAlindiBildirimi(vanity, ms, sucluid = null) {
    const mesaj =
        `\`\`\`diff\n` +
        `+ URL GERİ ALINDI!\n` +
        `═══════════════════════════════════════\n` +
        `  URL: ${vanity}\n` +
        `  Süre: ${ms}ms\n` +
        `  Suçlu: ${sucluid || 'Tespit edilemedi'}\n` +
        `  Zaman: ${new Date().toLocaleString('tr-TR')}\n` +
        `═══════════════════════════════════════\n` +
        `\`\`\` ||@everyone||`;
    await bildirimGonder(mesaj);
}

const SUBDOMAINS = ['canary.discord.com', 'discord.com', 'ptb.discord.com'];
const API_VERSIONS = ['v10', 'v9'];
const HTTP2_SESSIONS_PER_SUBDOMAIN = 2;

const http2Sessions = new Map();

function createHttp2Session(subdomain) {
    return new Promise((resolve) => {
        const session = http2.connect(`https://${subdomain}`, {
            settings: {
                enablePush: false,
                initialWindowSize: 1048576,
                maxConcurrentStreams: 100
            },
            peerMaxConcurrentStreams: 100
        });

        session.on('connect', () => {
            resolve(session);
        });

        session.on('error', (err) => {
            hata(`HTTP/2 session error (${subdomain}):`, err.message);
            resolve(null);
        });

        session.on('close', () => { });
        setTimeout(() => resolve(null), 5000);
    });
}

async function initHttp2Sessions() {
    for (const subdomain of SUBDOMAINS) {
        const sessions = [];
        for (let i = 0; i < HTTP2_SESSIONS_PER_SUBDOMAIN; i++) {
            const session = await createHttp2Session(subdomain);
            if (session) sessions.push(session);
        }
        http2Sessions.set(subdomain, sessions);
        log(`HTTP/2 sessions for ${subdomain}: ${sessions.length} connected`);
    }
    log('HTTP/2 sessions initialized');
}

function refreshHttp2Sessions() {
    for (const subdomain of SUBDOMAINS) {
        const oldSessions = http2Sessions.get(subdomain) || [];
        oldSessions.forEach(s => { try { s.destroy(); } catch { } });

        const newSessions = [];
        for (let i = 0; i < HTTP2_SESSIONS_PER_SUBDOMAIN; i++) {
            newSessions.push(createHttp2Session(subdomain));
        }
        http2Sessions.set(subdomain, newSessions);
    }
    log('HTTP/2 sessions refreshed');
}

const TLS_POOL_SIZE = 6;
let tlsPool = [];

function createTlsSocket(subdomain) {
    return new Promise((resolve) => {
        const socket = tls.connect({
            host: subdomain,
            port: 443,
            rejectUnauthorized: false,
            ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:AES128-SHA',
            servername: subdomain
        }, () => resolve(socket));
        socket.on('error', () => resolve(null));
        setTimeout(() => resolve(null), 3000);
    });
}

async function initTlsPool() {
    tlsPool = [];
    const promises = [];

    for (const subdomain of SUBDOMAINS) {
        for (let i = 0; i < TLS_POOL_SIZE / SUBDOMAINS.length; i++) {
            promises.push(
                createTlsSocket(subdomain).then(socket => {
                    if (socket) tlsPool.push({ socket, subdomain, used: false });
                })
            );
        }
    }

    await Promise.allSettled(promises);
    log(`${tlsPool.length} TLS sockets warmed`);
}

async function refreshTlsPool() {
    tlsPool.forEach(item => {
        try { item.socket.destroy(); } catch { }
    });
    await initTlsPool();
}

const axiosAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 32,
    rejectUnauthorized: false,
    timeout: 5000
});

class paranoid {
    constructor() {
        this.oturumAc();
        log("[HTTP2] MFA oturumu açıldı.");
    }
    oturumAc() {
        this.oturum?.destroy();
        this.oturum = http2.connect("https://canary.discord.com", {
            settings: { noDelay: true },
            secureContext: tls.createSecureContext({ ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:AES128-SHA' })
        });
        this.oturum.on('error', (err) => {
            hata("[HTTP2] oturumda hata:", err);
            setTimeout(() => this.oturumAc(), 5000);
        });
        this.oturum.on('close', () => {
            hata("[HTTP2] oturum kapandi tekrar deniyorum.");
            setTimeout(() => this.oturumAc(), 5000);
        });
    }
    async istek(metot, yol, ozellestirilmisBasliklar = {}, govde = null) {
        return new Promise((coz, red) => {
            const basliklar = {
                'Content-Type': 'application/json',
                'Authorization': CONFIG.token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) paranoid/1.0.1130 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36',
                'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJwdGIiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC4xMTMwIiwib3NfdmVyc2lvbiI6IjEwLjAuMTkwNDUiLCJvc19hcmNoIjoieDY0IiwiYXBwX2FyY2giOiJ4NjQiLCJzeXN0ZW1fbG9jYWxlIjoidHIiLCJoYXNfY2xpZW50X21vZHMiOmZhbHNlLCJicm93c2VyX3VzZXJfYWdlbnQiOiJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBkaXNjb3JkLzEuMC4xMTMwIENocm9tZS8xMjguMC42NjEzLjE4NiBFbGVjdHJvbi8zMi4yLjcgU2FmYXJpLzUzNy4zNiIsImJyb3dzZXJfdmVyc2lvbiI6IjMyLjIuNyIsIm9zX3Nka192ZXJzaW9uIjoiMTkwNDUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNjY5NTUsIm5hdGl2ZV9idWlsZF9udW1iZXIiOjU4NDYzLCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==',
                ...ozellestirilmisBasliklar,
                ":method": metot,
                ":authority": "discord.com",
                ":scheme": "https"
            };
            if (yol) basliklar[":path"] = yol;
            const stream = this.oturum.request(basliklar);
            const parcaciklar = [];
            stream.on("data", chunk => parcaciklar.push(chunk));
            stream.on("end", () => coz(Buffer.concat(parcaciklar).toString('utf8')));
            stream.on("error", red);
            if (govde) stream.write(typeof govde === 'string' ? govde : JSON.stringify(govde));
            stream.end();
        });
    }
}
const paranoidClient = new paranoid();


async function bilet() {
    try {
        log("[MFA] ticket aliniyor");
        const veri = JSON.parse(await paranoidClient.istek('PATCH', '/api/v9/guilds/0/vanity-url'));
        if (veri.code === 200) {
            log('[MFA] mfa gerek yok devam');
            return true;
        }
        else if (veri.code === 60003) {
            log('[MFA] mfa lazım, bilet:', veri.mfa.ticket);
            await mfa(veri.mfa.ticket);
            return true;
        }
        else log('[MFA] yanit alamadim:', veri.code);
    } catch (err) { hata('[MFA] mfa hatası:', err); }
    return false;
}

async function mfa(biletToken) {
    try {
        log("[MFA] dogrulama baslatildi.");
        const veri = JSON.parse(await paranoidClient.istek('POST', '/api/v9/mfa/finish', { 'Content-Type': 'application/json' }, JSON.stringify({ ticket: biletToken, mfa_type: 'password', data: CONFIG.sifre })));
        if (veri.token) {
            mfaJetonu = veri.token;
            log('[MFA] mfa dogrulandi :)');
        }
        else throw new Error(`[MFA] Yanıt alınamadı: ${JSON.stringify(veri)}`);
    } catch (err) { hata('[MFA] dogrulanmadi', err); }
}

async function mfaDogrulama() {
    while (true) {
        let tamam = false;
        while (!tamam) {
            tamam = await bilet();
            if (!tamam) {
                hata("[MFA] mfa dogrulanmadi tekrar deniyorum");
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        await new Promise(r => setTimeout(r, 4 * 60 * 1000)); // 4 dakikada bir yenile
    }
}

async function connectionRefreshLoop() {
    while (true) {
        await new Promise(r => setTimeout(r, 45000));
        refreshHttp2Sessions();
        await refreshTlsPool();
    }
}

const PATCH_SUBDOMAINLER = [
    'canary.discord.com',
    'discord.com',
    'ptb.discord.com'
];
const PATCH_APIVERLER = ['v9', 'v10'];
const PATCH_HEADERLAR = () => ({
    Authorization: CONFIG.token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) paranoid/1.0.1130 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36',
    'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJwdGIiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC4xMTMwIiwib3NfdmVyc2lvbiI6IjEwLjAuMTkwNDUiLCJvc19hcmNoIjoieDY0IiwiYXBwX2FyY2giOiJ4NjQiLCJzeXN0ZW1fbG9jYWxlIjoidHIiLCJoYXNfY2xpZW50X21vZHMiOmZhbHNlLCJicm93c2VyX3VzZXJfYWdlbnQiOiJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBkaXNjb3JkLzEuMC4xMTMwIENocm9tZS8xMjguMC42NjEzLjE4NiBFbGVjdHJvbi8zMi4yLjcgU2FmYXJpLzUzNy4zNiIsImJyb3dzZXJfdmVyc2lvbiI6IjMyLjIuNyIsIm9zX3Nka192ZXJzaW9uIjoiMTkwNDUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNjY5NTUsIm5hdGl2ZV9idWlsZF9udW1iZXIiOjU4NDYzLCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==',
    'X-Discord-MFA-Authorization': mfaJetonu,
    Cookie: `__Secure-recent_mfa=${mfaJetonu}`,
});
const PATCH_BODY = (vanity) => JSON.stringify({ code: vanity });

async function urlGeriAl(vanity) {
    koruma(`URL geri alınıyor: ${chalk.green(vanity)} (hedef sunucu: ${chalk.yellow(CONFIG.hedefGuildId)})`);
    const patchBody = PATCH_BODY(vanity);

    const startMs = Date.now();
    let urlAlindi = false;

    const agent = new https.Agent({
        keepAlive: true,
        maxSockets: 32,
        rejectUnauthorized: false,
        secureProtocol: 'TLSv1_2_method'
    });

    const http2Patchler = PATCH_SUBDOMAINLER.flatMap(subdomain =>
        PATCH_APIVERLER.map(apiVer =>
            paranoidClient.istek(
                "PATCH",
                `/api/${apiVer}/guilds/${CONFIG.hedefGuildId}/vanity-url`,
                {
                    ...PATCH_HEADERLAR(),
                    ":authority": subdomain,
                },
                patchBody
            ).then(res => {
                try {
                    const data = typeof res === "string" ? JSON.parse(res) : res;
                    if ((data.code === vanity || data.code === 200 || data.vanity_url_code === vanity) && !urlAlindi) {
                        urlAlindi = true;
                        const ms = Date.now() - startMs;
                        basari(chalk.bgGreen(`[URL GERİ ALINDI] ${vanity} ${ms}ms [HTTP2][${subdomain}][${apiVer}]`));
                    }
                } catch { }
            }).catch(e => {
                if (e && e.message && e.message.includes('429')) {
                    hata(`[YAMA][HTTP2][${subdomain}][${apiVer}] rate limit.`);
                }
            })
        )
    );

    const axiosPatchler = PATCH_SUBDOMAINLER.flatMap(subdomain =>
        PATCH_APIVERLER.map(apiVer => {
            const url = `https://${subdomain}/api/${apiVer}/guilds/${CONFIG.hedefGuildId}/vanity-url`;
            return axios.patch(url, { code: vanity }, { headers: PATCH_HEADERLAR(), httpsAgent: agent })
                .then(res => {
                    try {
                        const data = res?.data;
                        if ((data.code === vanity || data.code === 200 || data.vanity_url_code === vanity) && !urlAlindi) {
                            urlAlindi = true;
                            const ms = Date.now() - startMs;
                            basari(chalk.bgGreen(`[URL GERİ ALINDI] ${vanity} ${ms}ms [AXIOS][${subdomain}][${apiVer}]`));
                        }
                    } catch { }
                })
                .catch(e => {
                    if (e && e.response && e.response.status === 429) {
                        hata(`[YAMA][AXIOS][${subdomain}][${apiVer}] rate limit.`);
                    }
                });
        })
    );

    const tlsPatchler = PATCH_SUBDOMAINLER.flatMap(subdomain =>
        PATCH_APIVERLER.flatMap(apiVer =>
            Array.from({ length: 2 }).map(() => new Promise(resolve => {
                const s = tls.connect({
                    host: subdomain,
                    port: 443,
                    rejectUnauthorized: false,
                    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:AES128-SHA'
                }, () => {
                    s.write(
                        `PATCH /api/${apiVer}/guilds/${CONFIG.hedefGuildId}/vanity-url HTTP/1.1\r\n` +
                        `Host: ${subdomain}\r\n` +
                        `Authorization: ${CONFIG.token}\r\n` +
                        `Content-Type: application/json\r\n` +
                        `X-Discord-MFA-Authorization: ${mfaJetonu}\r\n` +
                        `Cookie: __Secure-recent_mfa=${mfaJetonu}\r\n` +
                        `Content-Length: ${patchBody.length}\r\n\r\n` +
                        patchBody
                    );
                });
                s.on('data', (data) => {
                    const ext = extractJsonFromString(data.toString());
                    const bul = ext.find((e) => e.code || e.message);
                    if (bul) info(`[YAMA][TLS][${subdomain}][${apiVer}] discord response:`, bul);
                    try {
                        if ((bul?.code === vanity || bul?.code === 200 || bul?.vanity_url_code === vanity) && !urlAlindi) {
                            urlAlindi = true;
                            const ms = Date.now() - startMs;
                            basari(chalk.bgGreen(`[URL GERİ ALINDI] ${vanity} ${ms}ms [TLS][${subdomain}][${apiVer}]`));
                        }
                    } catch { }
                    s.destroy();
                    resolve();
                });
                s.on('error', (err) => {
                    if (err && err.message && err.message.includes('429')) {
                        hata(`[YAMA][TLS][${subdomain}][${apiVer}] rate limited.`);
                    }
                    resolve();
                });
            }))
        )
    );

    await Promise.allSettled([
        ...http2Patchler,
        ...axiosPatchler,
        ...tlsPatchler
    ]);

    const totalMs = Date.now() - startMs;
    info(`[YAMA] yama denemeleri bitti. Toplam süre: ${totalMs}ms`);

    if (urlAlindi) {
        // Audit log kontrolü ve yasaklama
        process.nextTick(() => auditLogKontrolVeYasakla(vanity, totalMs));
        return true;
    } else {
        hata(`URL geri alma başarısız: ${vanity}`);
        return false;
    }
}

async function auditLogKontrolVeYasakla(vanity, ms) {
    try {
        koruma('Audit log kontrol ediliyor...');
        const auditLogStr = await paranoidClient.istek(
            'GET',
            `/api/v9/guilds/${CONFIG.hedefGuildId}/audit-logs?action_type=1&limit=1`
        );

        const auditLog = typeof auditLogStr === 'string' ? JSON.parse(auditLogStr) : auditLogStr;

        if (!auditLog || !auditLog.audit_log_entries || auditLog.audit_log_entries.length === 0) {
            hata('Audit log entry bulunamadı');
            await urlGeriAlindiBildirimi(vanity, ms, null);
            return;
        }

        const entry = auditLog.audit_log_entries[0];
        const userId = entry.user_id;

        if (!userId) {
            hata('Suçlu kullanıcı ID bulunamadı');
            await urlGeriAlindiBildirimi(vanity, ms, null);
            return;
        }

        koruma(`Suçlu tespit edildi: ${chalk.red(userId)}`);

        await urlGeriAlindiBildirimi(vanity, ms, userId);


        await yasakla(userId);

    } catch (err) {
        hata('Audit log kontrolünde hata:', err.message);
        await urlGeriAlindiBildirimi(vanity, ms, null);
    }
}

async function yasakla(userId) {
    try {
        koruma(`Kullanıcı yasaklanıyor: ${userId}`);

        const banBody = JSON.stringify({
            delete_message_seconds: 0
        });

        const result = await paranoidClient.istek(
            'PUT',
            `/api/v9/guilds/${CONFIG.hedefGuildId}/bans/${userId}`,
            {
                ...PATCH_HEADERLAR(),
                'X-Audit-Log-Reason': encodeURIComponent(CONFIG.yasaklamaSebebi)
            },
            banBody
        );

        basari(`Kullanıcı yasaklandı: ${userId} | Sebep: ${CONFIG.yasaklamaSebebi}`);
    } catch (err) {
        hata(`Yasaklama başarısız: ${userId}`, err.message || err);
    }
}

function createGateway() {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json', {
        handshakeTimeout: 5000,
        perMessageDeflate: false
    });

    let heartbeatInterval;
    let sequence = null;

    ws.on('open', () => {
        info('Gateway bağlantısı açıldı');

        ws.send(JSON.stringify({
            op: 2,
            d: {
                token: CONFIG.token,
                intents: 513, 
                properties: { os: 'linux', browser: 'firefox', device: 'koruma' }
            }
        }));
    });

    ws.on('message', (data) => {
        const str = data.toString();


        if (str.includes('"s":')) {
            try {
                const parsed = JSON.parse(str);
                if (parsed.s) sequence = parsed.s;
            } catch { }
        }

        // Heartbeat
        if (str.includes('"op":10')) {
            try {
                const parsed = JSON.parse(str);
                if (parsed.op === 10) {
                    heartbeatInterval = setInterval(() => {
                        ws.send(JSON.stringify({ op: 1, d: sequence }));
                    }, parsed.d.heartbeat_interval);
                }
            } catch { }
            return;
        }

        if (str.includes('"READY"')) {
            try {
                const m = JSON.parse(str);
                if (m.t === 'READY' && m.d?.guilds) {
                    const hedefGuild = m.d.guilds.find(g => g.id === CONFIG.hedefGuildId);
                    if (hedefGuild && hedefGuild.vanity_url_code) {
                        korunanVanityUrl = hedefGuild.vanity_url_code;
                        koruma(`Korunan URL kaydedildi: ${chalk.green(korunanVanityUrl)}`);
                        console.log(chalk.bgBlue.white('\n═══════════════════════════════════════════════════════════════'));
                        console.log(chalk.bgBlue.white(`  KORUMA AKTİF | Guild: ${CONFIG.hedefGuildId} | URL: ${korunanVanityUrl}  `));
                        console.log(chalk.bgBlue.white('═══════════════════════════════════════════════════════════════\n'));
                        acilisBildirimi();
                    } else {
                        hata(`Hedef guild (${CONFIG.hedefGuildId}) bulunamadı veya vanity URL yok!`);
                    }
                }
            } catch { }
            return;
        }

        if (str.includes('"GUILD_UPDATE"')) {
            process.nextTick(() => handleGuildUpdate(str));
        }
    });

    ws.on('close', () => {
        hata('Gateway bağlantısı kapandı, yeniden bağlanılıyor...');
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        setTimeout(createGateway, 1000);
    });

    ws.on('error', () => {
        ws.close();
    });
}

function handleGuildUpdate(data) {
    try {
        const m = JSON.parse(data);
        if (m.t !== 'GUILD_UPDATE' || !m.d) return;

        if (m.d.id !== CONFIG.hedefGuildId) return;

        const yeniVanity = m.d.vanity_url_code || null;

        if (korunanVanityUrl && yeniVanity !== korunanVanityUrl) {
            koruma(chalk.bgRed.white(` URL DEĞİŞTİRİLDİ! ${korunanVanityUrl} → ${yeniVanity || 'YOK'} `));

            process.nextTick(() => urlGeriAl(korunanVanityUrl));
        }
    } catch { }
}

async function initialize() {
    console.log(chalk.bgBlue.white('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.bgBlue.white('              GUILD URL KORUMA SİSTEMİ                          '));
    console.log(chalk.bgBlue.white('═══════════════════════════════════════════════════════════════\n'));

    info(`Hedef Guild ID: ${chalk.yellow(CONFIG.hedefGuildId)}`);
    info('Bağlantılar hazırlanıyor...');
    await initHttp2Sessions();
    await initTlsPool();
    info('MFA doğrulaması yapılıyor...');
    let mfaTamam = false;
    while (!mfaTamam) {
        mfaTamam = await bilet();
        if (!mfaTamam) {
            hata("[MFA] ilk doğrulama başarısız, tekrar deneniyor...");
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    info('Gateway başlatılıyor...');
    createGateway();
    mfaDogrulama();
    connectionRefreshLoop();

    info('Sistem hazır - Koruma bekleniyor...\n');
}

initialize();

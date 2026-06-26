const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas'); // Pastikan ini ada di paling atas file
const userStates = new Map();
const FormData = require('form-data');
const activeTransactions = new Set();
const activeSearch = {}; 
const app = express();
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.WEB_APP_URL || '';

const getMainMenuKeyboard = (baseRows = []) => ({
    inline_keyboard: [
        ...(MINI_APP_URL ? [[{ text: 'BUKA MOCHI OTP', web_app: { url: MINI_APP_URL } }]] : []),
        ...baseRows
    ]
});

// --- 1. SETUP & CONFIG ---
console.log("🚀 SYSTEM STARTING...");

if (!process.env.BOT_TOKEN || !process.env.PAKASIR_API_KEY || !process.env.ADMIN_ID) {
    console.error("❌ ERROR: .env tidak lengkap!");
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let cachedTotalUser = '0';
let lastUserCountTime = 0;

// --- 2. MIDDLEWARE & HELPER ---
const formatRp = (angka) => 'Rp ' + Number(angka).toLocaleString('id-ID');

const formatDate = (dateString) => {
    const date = new Date(dateString);
    // FIX: Tambahkan timezone Asia/Jakarta dan second: '2-digit'
    return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit', // <--- Tambah Detik
        timeZone: 'Asia/Jakarta' // <--- Paksa ke WIB
    }).replace(/\./g, ':');
};

const getWIBTime = () => {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Pastikan objek date mengambil waktu Asia/Jakarta
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    
    const dayName = days[now.getDay()];
    const date = String(now.getDate()).padStart(2, '0');
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();
    
    // Tambahkan second: '2-digit' agar ada detiknya
    const time = now.toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', // <--- Tambahan Detik
        hour12: false 
    }).replace(/\./g, ':');

    return `${dayName}, ${date} ${monthName} ${year} ${time} WIB`;
};

const esc = (text) => {
    if (!text) return '';
    // Tambahan backtick (`) dan double backslash (\\) untuk pertahanan ekstra
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
};

// Deklarasi variabel global untuk kurs
let currentUsdtToIdr = 17500; 

async function updateUsdtRate() {
    try {
        // Tembak API TabTrader untuk data USDT/IDR real-time
        const res = await axios.get('https://coingeko-info.tabtrader.com/coin/data/usdt', { 
            timeout: 10000 
        });

        if (res.data && res.data.data && res.data.data.market_data) {
            const realPrice = res.data.data.market_data.current_price.idr;
            
            // 🔥 Tetap gunakan buffer Rp 300 untuk keamanan admin
            currentUsdtToIdr = Math.round(realPrice + 300); 
            
            // Teks log diubah menjadi (1 Jam)
            console.log(`[${new Date().toLocaleTimeString()}] 🔄 Kurs USDT (1 Jam): Rp ${currentUsdtToIdr.toLocaleString()}`);
        }
    } catch (err) {
        // Teks error disesuaikan
        console.error("⚠️ Gagal update kurs (Coba lagi 1 jam kemudian):", err.message);
    }
}

// 🔥 SET INTERVAL TIAP 1 JAM (3.600.000 ms)
setInterval(updateUsdtRate, 3600000);

// Panggil pertama kali saat bot baru dinyalakan
updateUsdtRate();

async function checkUser(ctx) {
    const user = ctx.from;

    const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    // 1. Register jika belum ada
    if (!data) {
        const newUser = {
            id: user.id,
            username: user.username,
            balance: 0,
            is_banned: false
        };

        await supabase.from('users').insert(newUser);
        return newUser;
    }

    // 2. Jika BAN
    if (data.is_banned) {

        // 🔥 kalau dari tombol
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(
                "⛔ Akun Anda telah diblokir oleh admin.",
                { show_alert: true }
            ).catch(()=>{});
        } 
        // 🔥 kalau dari command
        else {
            await ctx.reply(
                "⛔ Akun Anda telah diblokir oleh admin."
            ).catch(()=>{});
        }

        return null;
    }

    return data;
}

async function safeEditMessage(bot, chatId, messageId, text, extra = {}) {
    try {
        await bot.telegram.editMessageText(chatId, messageId, null, text, extra);
    } catch (err) {
        if (
            err.response &&
            err.response.error_code === 400 &&
            err.response.description.includes('message is not modified')
        ) {
            // AMAN → jangan lakukan apa-apa
            return;
        }
        console.error('EditMessage Error:', err);
    }
}

// --- POLLING KHUSUS MULTISERVICE (VAK-SMS) ---
async function pollSMSMulti(
    chatId,
    messageId,
    idNum,
    serviceName,
    phoneNumber,
    startTime,
    hargaRefund,
    lastCodes = ""
) {
    const DURATION_LIMIT = 1200000; // 20 menit

    try {
        const { data: order } = await supabase
            .from('orders_multi')
            .select('status, sms_code')
            .eq('id_num', idNum)
            .maybeSingle();

        // ❌ Stop kalau sudah tidak aktif
        if (!order || order.status !== 'active') return;

        const now = Date.now();
        const timeElapsed = now - startTime;

        // =========================
        // ⏰ EXPIRED
        // =========================
        if (timeElapsed >= DURATION_LIMIT) {

            console.log(`⏰ [Multi] Waktu habis untuk nomor: ${phoneNumber}`); 

            // Tutup di provider
            await axios.get(
                `https://vak-sms.com/api/setStatus/?apiKey=${process.env.VAK_SMS_API_KEY}&status=end&idNum=${idNum}`,
                { timeout: 5000 } 
            ).catch(() => {});

            // 🔥 TENTUKAN STATUS DINAMIS
            const finalStatus = order.sms_code ? 'completed' : 'cancelled';

            // 🔒 LOCK ORDER (WAJIB)
            const { data: updated } = await supabase
                .from('orders_multi')
                .update({ status: finalStatus }) 
                .eq('id_num', idNum)
                .eq('status', 'active') 
                .select();

            if (!updated || updated.length === 0) {
                return; // sudah diproses sebelumnya
            }

            // =========================
            // ✅ SUDAH ADA SMS → TIDAK REFUND
            // =========================
            if (order.sms_code) {

                const msgDone =
`✅ *ORDER SELESAI*

📦 Layanan: *${esc(serviceName)}*
📱 Nomor  : \`${esc(phoneNumber)}\`
⌛ ${esc('Masa aktif habis, pesanan selesai otomatis.')}`;

                await safeEditMessage(bot, chatId, messageId, msgDone, {
                    parse_mode: 'MarkdownV2'
                });

            } else {

                // =========================
                // 💰 REFUND AMAN
                // =========================
                const refundAmount = Number(hargaRefund) || 0;

                const { error: refundError } = await supabase.rpc('increment_balance', {
                    user_id: chatId,
                    amount: refundAmount
                });

                if (refundError) {
                    console.log("❌ REFUND ERROR:", refundError.message);
                } else {
                    console.log(`💰 [Multi] Saldo ${refundAmount} direfund untuk ${phoneNumber}`); 
                }

                const msgExpire =
`⏰ *WAKTU HABIS*

📦 Layanan: *${esc(serviceName)}*
📱 Nomor  : \`${esc(phoneNumber)}\`
💰 Saldo  : ${esc(formatRp(refundAmount))} dikembalikan\\.`;

                await safeEditMessage(bot, chatId, messageId, msgExpire, {
                    parse_mode: 'MarkdownV2'
                });
            }

            return;
        }

        // =========================
        // 📩 CEK SMS MASUK
        // =========================
        // 🔥 SPAM LOG DIHILANGKAN AGAR VPS TIDAK PANAS
        // console.log(`🔄 [Multi] Cek OTP Server 1 -> Nomor: ${phoneNumber}`); 

        const res = await axios.get(
            `https://vak-sms.com/api/getSmsCode/?apiKey=${process.env.VAK_SMS_API_KEY}&idNum=${idNum}&all=1`,
            { timeout: 5000 } 
        );

        const codesArr = Array.isArray(res.data?.smsCode)
            ? res.data.smsCode
            : (res.data?.smsCode ? [res.data.smsCode] : []);

        const codesStr = codesArr.join(', ');

        if (codesArr.length > 0 && codesStr !== lastCodes) {

            console.log(`✅ [Multi] OTP MASUK UNTUK ${phoneNumber} : ${codesStr}`); // Log krusial, dipertahankan

            await supabase
                .from('orders_multi')
                .update({ sms_code: codesStr })
                .eq('id_num', idNum);

            const expiryTime = new Date(startTime + DURATION_LIMIT)
                .toLocaleTimeString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    hour12: false
                })
                .replace(/\./g, ':');

            const msgUpdate =
`✅ *ORDER BERHASIL*

📦 Layanan : *${esc(serviceName)}*
📱 Nomor : \`${esc(phoneNumber)}\`
💰 Harga : ${esc(formatRp(hargaRefund))}

📩 OTP CODE : \`${esc(codesStr)}\`

⏳ *Nokos Expired Pada : ${esc(expiryTime)} WIB*`;

            await safeEditMessage(bot, chatId, messageId, msgUpdate, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📩 Request SMS Lagi', `more_m_${idNum}`)]
                ])
            });

            // lanjut polling
            return setTimeout(() =>
                pollSMSMulti(
                    chatId,
                    messageId,
                    idNum,
                    serviceName,
                    phoneNumber,
                    startTime,
                    hargaRefund,
                    codesStr
                ),
                7000
            );
        }

        // =========================
        // 🔁 LOOP
        // =========================
        setTimeout(() =>
            pollSMSMulti(
                chatId,
                messageId,
                idNum,
                serviceName,
                phoneNumber,
                startTime,
                hargaRefund,
                lastCodes
            ),
            7000
        );

    } catch (e) {
        console.log(`❌ POLL MULTI ERROR [${phoneNumber}]:`, e.message); // Log error dipertahankan

        setTimeout(() =>
            pollSMSMulti(
                chatId,
                messageId,
                idNum,
                serviceName,
                phoneNumber,
                startTime,
                hargaRefund,
                lastCodes
            ),
            10000
        );
    }
}

// --- UPDATE FUNGSI POLL SMS UNTUK AUTO-DETECT SMS BERIKUTNYA ---
async function pollSMS(
    chatId,
    messageId,
    activationId,
    serviceName,
    phoneNumber,
    startTime,
    previousCode = null
) {
    const DURATION_LIMIT = 1500000; // 25 Menit

    try {
        const now = Date.now();
        const timeElapsed = now - startTime;

        // 🔥 1. CEK DATABASE LOKAL (Super Ringan)
        const { data: order, error: dbError } = await supabase
            .from('orders')
            .select('status, sms_code, price')
            .eq('activation_id', activationId)
            .maybeSingle();

        if (dbError) {
            console.log(`[DEBUG-ERROR] Supabase Error:`, dbError.message);
            return setTimeout(() => pollSMS(chatId, messageId, activationId, serviceName, phoneNumber, startTime, previousCode), 5000);
        }

        // Berhenti jika order dicancel user atau sudah selesai
        if (!order || order.status !== 'active') return;

        // ===============================
        // 2. TIMEOUT HANDLING (25 Menit)
        // ===============================
        if (timeElapsed > DURATION_LIMIT) {
            
            console.log(`⏰ [SMSBower] Waktu habis untuk nomor: ${phoneNumber}`); 

            let shouldRefund = false;

            if (order.sms_code) {
                // Selesaikan di vendor jika sudah ada OTP (Uang tidak kembali)
                await axios.get(
                    `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=6&id=${activationId}`,
                    { timeout: 20000 } 
                ).catch(() => {});
            } else {
                // Mutlak refund jika Webhook tidak pernah mengirim OTP
                shouldRefund = true; 
                
                // Cancel di vendor agar saldo pusat tidak terpotong (Best Effort)
                try {
                    await axios.get(
                        `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=8&id=${activationId}`,
                        { timeout: 20000 } 
                    );
                    console.log(`✅ [SMSBower] Berhasil cancel di pusat untuk ${phoneNumber}`);
                } catch (err) {
                    console.log(`⚠️ [SMSBower] Gagal cancel ke pusat untuk ${phoneNumber}, tapi user tetap di-refund.`);
                }
            }

            // Simpan status akhir yang benar sebelum eksekusi refund
            const finalStatus = shouldRefund ? 'cancelled' : 'completed';
            const { data: updated } = await supabase
                .from('orders')
                .update({ status: finalStatus })
                .eq('activation_id', activationId)
                .eq('status', 'active')
                .select();

            if (!updated || updated.length === 0) return;

            // Eksekusi UI dan Refund
            if (!shouldRefund) {
                await bot.telegram.editMessageText(chatId, messageId, null, 
                    `✅ *ORDER SELESAI*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
⏳ *Masa aktif habis*, pesanan selesai otomatis`,
                    { parse_mode: 'MarkdownV2' }
                ).catch(() => {});
            } else {
                const refundAmount = Number(order.price) || 0;
                await supabase.rpc('increment_balance', { user_id: chatId, amount: refundAmount });
                console.log(`💰 [SMSBower] Saldo ${refundAmount} direfund untuk ${phoneNumber}`); 

                await bot.telegram.editMessageText(chatId, messageId, null,
                    `⏰ *WAKTU HABIS*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Saldo :* ${esc(formatRp(refundAmount))} dikembalikan\\.`,
                    { parse_mode: 'MarkdownV2' }
                ).catch(() => {});
            }
            return;
        }

        // ===============================
        // 3. PROSES OTP BARU (Hybrid: Webhook + Fallback API)
        // ===============================
        let newCode = order.sms_code;

        // 🔥 JEMPUT BOLA JIKA WEBHOOK KOSONG ATAU KODE MASIH SAMA DENGAN OTP LAMA
        if (!newCode || newCode === previousCode) {
            try {
                const resApi = await axios.get(
                    `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getStatus&id=${activationId}`,
                    { timeout: 5000 }
                );
                
                // Jika status OK, artinya SMSBower punya kode terbaru
                if (resApi.data && resApi.data.includes('STATUS_OK')) {
                    const fetchedCode = resApi.data.split(':')[1];
                    
                    // Pastikan kode yang didapat adalah OTP baru (bukan OTP lama)
                    if (fetchedCode && fetchedCode !== previousCode) {
                        newCode = fetchedCode;
                        
                        // Simpan ke Supabase agar Webhook & UI sinkron
                        await supabase.from('orders').update({ sms_code: newCode }).eq('activation_id', activationId);
                        console.log(`🛡️ [Fallback] Berhasil jemput kode BARU dari API untuk ${phoneNumber}`);
                    }
                }
            } catch (err) {
                // Abaikan error agar loop tetap berjalan
            }
        }

        if (newCode && newCode !== previousCode) {
            
            const cleanCode = newCode.trim();

            console.log(`✅ [SMSBower] OTP MASUK UNTUK ${phoneNumber} : ${cleanCode}`); 

            const { data: user } = await supabase
                .from('users')
                .select('balance')
                .eq('id', chatId)
                .maybeSingle();

            const expiryTime = new Date(startTime + DURATION_LIMIT)
                .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta', hour12: false })
                .replace(/\./g, ':');

            let smsDisplay = `📩 *OTP CODE :* \`${esc(cleanCode)}\``;
            if (previousCode && previousCode !== cleanCode) {
                smsDisplay = `📩 *OTP LAMA:* \`${esc(previousCode)}\`\n📩 *OTP BARU:* \`${esc(cleanCode)}\``;
            }

            const msgText = `✅ *ORDER BERHASIL*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price || 0))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

${smsDisplay}

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

            try {
                await bot.telegram.editMessageText(chatId, messageId, null, msgText, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Selesai', callback_data: `st6_${activationId}` }],
                            [{ text: '📩 Request SMS Lagi', callback_data: `another_sms_${activationId}` }]
                        ]
                    }
                });

                // Jika berhasil edit, perbarui memori bot
                previousCode = cleanCode;

            } catch (err) {
                if (err.message.includes('message is not modified')) {
                    previousCode = cleanCode;
                } else {
                    console.error("❌ [POLL EDIT ERROR]", err.message); 
                    throw err; 
                }
            }
        }

        // ===============================
        // 4. LOOPING (Peredam Panas CPU)
        // ===============================
        // Delay 8 detik agar aman untuk CPU VPS maupun Supabase
        const delay = previousCode ? 15000 : 8000; 

        setTimeout(() => {
            pollSMS(chatId, messageId, activationId, serviceName, phoneNumber, startTime, previousCode);
        }, delay);

    } catch (e) {
        console.error(`❌ [pollSMS ERROR - ${phoneNumber}]`, e.message); 
        setTimeout(() => {
            pollSMS(chatId, messageId, activationId, serviceName, phoneNumber, startTime, previousCode);
        }, 10000); // Saat error global, ulangi 10 detik kemudian
    }
}

//BANNED HANDLER ///
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const { data: user } = await supabase
        .from('users')
        .select('is_banned')
        .eq('id', userId)
        .maybeSingle();

    if (user?.is_banned) {

        // 🔥 kalau tombol
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery(
                "⛔ Akun Anda telah diblokir oleh admin.",
                { show_alert: true }
            ).catch(()=>{});
        }

        // 🔥 kalau command
        return ctx.reply(
            "⛔ Akun Anda telah diblokir oleh admin."
        ).catch(()=>{});
    }

    return next();
});

// --- 3. BOT START ---
bot.start(async (ctx) => {
    try {
        const userId = ctx.from.id;
        const payload = ctx.payload;
        const username = ctx.from.username || null;

        let user;

        const { data: userExist } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        // ⛔ CEK STATUS BANNED
        if (userExist && userExist.is_banned) {
            await ctx.deleteMessage().catch(() => {});
            const msgBanned = await ctx.reply("⛔ Akun Anda telah DIBLOKIR oleh Admin.\nAkses layanan dihentikan.");
            setTimeout(() => {
                ctx.telegram.deleteMessage(ctx.chat.id, msgBanned.message_id).catch(() => {});
            }, 5000);
            return; 
        }

        // ✅ PROSES INSERT USER BARU ATAU UPDATE
        if (!userExist) {
            let referrerId = null;
            if (payload && payload !== userId.toString()) {
                referrerId = parseInt(payload);
            }

            const { data: newUser } = await supabase
                .from('users')
                .insert({
                    id: userId,
                    username: username,
                    balance: 0,
                    referred_by: referrerId
                })
                .select().single();
            user = newUser;
        } else {
            // 🔥 OPTIMASI 1: Update username TANPA await dan hanya jika berubah
            if (userExist.username !== username) {
                supabase.from('users').update({ username: username }).eq('id', userId).then(); // Biarkan jalan di background
            }
            user = userExist;
        }

        if (!user) return ctx.reply("⚠️ Terjadi kesalahan, coba lagi.");

        // --- Logika Tampilan Menu ---
        const rawName = ctx.from.first_name || "Pelanggan";
        const displayName = esc(rawName);
        const usernameDisplay = user.username ? `@${esc(user.username)}` : 'NO';
        const saldo = esc(formatRp(user.balance || 0));

        const dateNow = esc(
            new Date().toLocaleString('id-ID', {
                day: '2-digit', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                timeZone: 'Asia/Jakarta'
            }).replace(/\./g, ':')
        );

        // ==========================================
        // 🔥 OPTIMASI 2: HYBRID CACHE TOTAL USER
        // ==========================================
        const now = Date.now();
        let totalUser = cachedTotalUser;

        if (cachedTotalUser === '0' || (now - lastUserCountTime > 10 * 60 * 1000)) {
            if (cachedTotalUser === '0') {
                // Jika bot baru nyala, TUNGGU sebentar agar tidak muncul "Menghitung..."
                try {
                    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
                    if (count) {
                        cachedTotalUser = count.toString();
                        lastUserCountTime = Date.now();
                        totalUser = cachedTotalUser;
                    }
                } catch (e) {}
            } else {
                // Jika cuma update rutin tiap 10 menit, lempar ke background (Tanpa Await)
                supabase.from('users').select('id', { count: 'exact', head: true }).then(({ count }) => {
                    if (count) {
                        cachedTotalUser = count.toString();
                        lastUserCountTime = Date.now();
                    }
                }).catch(() => {});
            }
        }
        
        // Pastikan tidak ada teks aneh jika gagal
        if (totalUser === '0') totalUser = 'Tidak diketahui';

        const msg = `Halo *${displayName}* 👋\n${dateNow} WIB\n\n*User Info :*\n*└ ID :* \`${userId}\`\n*└ Username :* ${usernameDisplay}\n\n*Balance Info :*\n*└ Balance :* ${saldo}\n\n*Bot Stats :*\n*└ Total User :* ${esc(totalUser)}\n\n*Info Promo :*\n*└ Channel :* @InfoNokosMochi\n\n*Shortcut :*\n*└ /start* \\- Mulai Bot`;

        const keyboard = getMainMenuKeyboard([
            [{ text: '📖 Cara Penggunaan', callback_data: 'panduan' }],
            [{ text: '📱 Order OTP', callback_data: 'menu_otp' }, { text: '💵 Deposit', callback_data: 'menu_deposit' }],
            [{ text: '📦 Histori Order', callback_data: 'hist_order' }, { text: '💳 Histori Deposit', callback_data: 'hist_depo' }],
            [{ text: '👥 Referral', callback_data: 'menu_referral' }, { text: '📞 Contact CS', url: 'https://t.me/MochiSupport' }],
            [{ text: '📜 Ketentuan Layanan', url: 'https://telegra.ph/KETENTUAN-LAYANAN-06-21' }]
        ]);

        // Kirim pesan
        await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });

    } catch (err) {
        console.log("Start Error:", err);
        return ctx.reply("❌ Terjadi kesalahan sistem.");
    }
});

// --- Tombol Kembali ---
bot.action('start', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});

        const user = await checkUser(ctx);
        if (!user) return; // 🔥 WAJIB (anti crash jika banned)

        // 🔥 PERBAIKAN: Fallback "Pelanggan" jika nama user invisible/kosong
        const rawName = ctx.from.first_name || "Pelanggan";
        const displayName = esc(rawName);
        
        const username = ctx.from.username ? `@${esc(ctx.from.username)}` : 'NO';
        const saldo = esc(formatRp(user.balance || 0));

        const dateNow = esc(
            new Date().toLocaleString('id-ID', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'Asia/Jakarta'
            }).replace(/\./g, ':')
        );

        // ==========================================
        // 🔥 OPTIMASI 2: HYBRID CACHE TOTAL USER
        // ==========================================
        const now = Date.now();
        let totalUser = cachedTotalUser;

        if (cachedTotalUser === '0' || (now - lastUserCountTime > 10 * 60 * 1000)) {
            if (cachedTotalUser === '0') {
                // TUNGGU sebentar jika bot baru nyala
                try {
                    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
                    if (count) {
                        cachedTotalUser = count.toString();
                        lastUserCountTime = Date.now();
                        totalUser = cachedTotalUser;
                    }
                } catch (e) {}
            } else {
                // Update rutin di background
                supabase.from('users').select('id', { count: 'exact', head: true }).then(({ count }) => {
                    if (count) {
                        cachedTotalUser = count.toString();
                        lastUserCountTime = Date.now();
                    }
                }).catch(() => {});
            }
        }
        
        if (totalUser === '0') totalUser = 'Tidak diketahui';

        const msg = `Halo *${displayName}* 👋\n${dateNow} WIB\n\n*User Info :*\n*└ ID :* \`${ctx.from.id}\`\n*└ Username :* ${username}\n\n*Balance Info :*\n*└ Balance :* ${saldo}\n\n*Bot Stats :*\n*└ Total User :* ${esc(totalUser)}\n\n*Info Promo :*\n*└ Channel :* @InfoNokosMochi\n\n*Shortcut :*\n*└ /start* \\- Mulai Bot`;

        const keyboard = getMainMenuKeyboard([
            [{ text: '📖 Cara Penggunaan', callback_data: 'panduan' }],
            [
                { text: '📱 Order OTP', callback_data: 'menu_otp' },
                { text: '💵 Deposit', callback_data: 'menu_deposit' }
            ],
            [
                { text: '📦 Histori Order', callback_data: 'hist_order' },
                { text: '💳 Histori Deposit', callback_data: 'hist_depo' }
            ],
            [
                { text: '👥 Referral', callback_data: 'menu_referral' },
                { text: '📞 Contact CS', url: 'https://t.me/MochiSupport' } 
            ],
            [{ text: '📜 Ketentuan Layanan', url: 'https://telegra.ph/KETENTUAN-LAYANAN-06-21' }]
        ]);

        try {
            await ctx.editMessageText(msg, {
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
            });
        } catch (e) {
            // 🔥 Fallback kalau tidak bisa edit (mencegah error merah di console)
            if (!e.message.includes('message is not modified')) {
                await ctx.reply(msg, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: keyboard
                }).catch(() => {});
            }
        }

    } catch (e) {
        console.error('[START ACTION ERROR]', e.message);
    }
});

bot.action('panduan', async (ctx) => {

    await ctx.answerCbQuery().catch(() => {});

    const user = await checkUser(ctx);
    if (!user) return;

    const text =
`📖 *PANDUAN PENGGUNAAN BOT*

1️⃣ *Deposit*
Isi saldo terlebih dahulu melalui menu *Deposit*\\.

2️⃣ *Order Nomor*
Pilih layanan yang ingin digunakan:
• *Order OTP* → untuk 1 aplikasi saja\\.
• *Multiservice* → 1 nomor dapat digunakan untuk beberapa aplikasi sekaligus\\.

3️⃣ *Gunakan Nomor*
Setelah order berhasil, saldo akan otomatis terpotong dan nomor akan diberikan oleh bot\\.

4️⃣ *Menunggu SMS*
Masukkan nomor tersebut ke aplikasi tujuan dan tunggu kode OTP masuk ke bot\\.

5️⃣ *Refund*
Jika kode OTP tidak masuk, tekan tombol *Batal / Refund*\\.  
Saldo akan dikembalikan secara otomatis\\.

⚠️ *Catatan:*  
Gunakan nomor segera setelah order untuk meningkatkan kemungkinan OTP masuk\\.`;

    await ctx.editMessageText(text, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Kembali', callback_data: 'start' }]
            ]
        }
    }).catch(()=>{});
});

bot.action('cek_saldo', async (ctx) => {
    const user = await checkUser(ctx);
    ctx.answerCbQuery(`💰 Saldo Anda saat ini: ${formatRp(user.balance)}`, { show_alert: true });
});

// 1. Menu Utama Multiservice
bot.action('menu_multi', async (ctx) => {
    // Menampilkan popup alert saat tombol diklik
    await ctx.answerCbQuery(
        "⚠️ MENU MAINTENANCE\n\nMaaf, fitur Multi-Service tidak tersedia untuk sementara waktu.", 
        { show_alert: true }
    ).catch(() => {});

    // Baris editMessageText dihapus agar pengguna tetap di menu utama
});

// 2. Pilih Operator
bot.action('multi_grab_ovo', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        
        const user = await checkUser(ctx);
        if (!user) return;

        // ===============================
        // AMBIL SETTINGS
        // ===============================
        const { data: settings } = await supabase
            .from('settings')
            .select('*');

        const hGrab = parseInt(settings?.find(s => s.key === 'harga_grab_multi')?.value || 3000);
        const hOvo = parseInt(settings?.find(s => s.key === 'harga_ovo_multi')?.value || 3000);
        const total = hGrab + hOvo;

        const text = `📶 *PILIH OPERATOR*

📦 Paket: Grab \\+ OVO
💰 Harga: *${esc(formatRp(total))}*

Silahkan pilih operator untuk Indonesia:`;

        const ops = ['telkomsel', 'indosat', 'xl', 'three', 'axis', 'smartfren', 'any'];
        const rows = [];

        for (let i = 0; i < ops.length; i += 2) {
            rows.push(
                ops.slice(i, i + 2).map(op => ({
                    text: op.toUpperCase(),
                    callback_data: `ex_m_${op}`
                }))
            );
        }

        rows.push([{ text: '🔙 Kembali', callback_data: 'menu_multi' }]);

        await ctx.editMessageText(text, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: rows }
        }).catch(() => {});

    } catch (err) {
        console.error("[MULTI MENU ERROR]", err.message);
    }
});

// 3. Eksekusi Order
bot.action(/^can_m_(.+)$/, async (ctx) => {

    const idNum = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 LOCK USER (ANTI SPAM)
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        const user = await checkUser(ctx);
        if (!user) return;

        const { data: ord } = await supabase
            .from('orders_multi')
            .select('*')
            .eq('id_num', idNum)
            .eq('user_id', userId)
            .maybeSingle();

        // ===============================
        // 1. VALIDASI ORDER
        // ===============================
        if (!ord || ord.status !== 'active') {
            return ctx.answerCbQuery(
                "❌ Pesanan sudah tidak aktif atau sudah dibatalkan.",
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 2. API CANCEL 
        // ===============================
        let res;
        try {
            res = await axios.get(
                `https://vak-sms.com/api/setStatus/?apiKey=${process.env.VAK_SMS_API_KEY}&status=end&idNum=${idNum}`,
                { timeout: 8000 } // 🔥 UBAH KE 8000 (8 Detik) agar tidak nyangkut di Telegram
            );
        } catch {
            // 🔥 Pesan instruksi agar user tahu harus ngapain (Tanpa menyebut "server")
            return ctx.answerCbQuery(
                "❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Batal.", 
                { show_alert: true }
            ).catch(()=>{});
        }

        if (res.data.status !== 'update') {
            return ctx.answerCbQuery(
                "⚠️ Gagal batal! SMS mungkin sudah masuk / expired.", 
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 3. 🔒 LOCK DB (ANTI DOUBLE REFUND)
        // ===============================
        const { data: updated } = await supabase
            .from('orders_multi')
            .update({ status: 'cancelled' })
            .eq('id_num', idNum)
            .eq('status', 'active')
            .select();

        if (!updated || updated.length === 0) {
            return ctx.answerCbQuery("❌ Pembatalan sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
        }

        const refundAmount = Number(ord.price_refund) || 0;

        // ===============================
        // 4. REFUND
        // ===============================
        const { error: refundError } = await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: refundAmount
        });

        if (refundError) {
            console.log("❌ REFUND ERROR:", refundError.message);
            return ctx.answerCbQuery("❌ Gagal refund saldo. Silakan hubungi admin.", { show_alert: true }).catch(()=>{});
        }

        // ===============================
        // 5. RESULT MESSAGE (Sukses Batal)
        // ===============================
        
        // Jawab callback (tanpa alert) agar spinner tombol berhenti
        await ctx.answerCbQuery().catch(()=>{});

        const msgCancel =
`❌ *PESANAN DIBATALKAN*

📦 Layanan: *${esc(ord.service_name)}*
📱 Nomor  : \`${esc(ord.phone_number)}\`
💰 Refund : *${esc(formatRp(refundAmount))}* telah masuk ke saldo Anda\\.`;

        // Baru di tahap ini kita timpa pesannya
        await ctx.editMessageText(msgCancel, {
            parse_mode: 'MarkdownV2'
        }).catch(()=>{});

    } catch (e) {
        console.error("Error Cancel Multi:", e.message);
        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(()=>{});
        } catch(err){}
    } finally {
        // 🔓 UNLOCK USER
        activeTransactions.delete(userId);
    }
});

bot.action(/^ex_m_(.+)$/, async (ctx) => {

    const operator = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 LOCK USER (ANTI SPAM & DOUBLE CLICK)
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);
    let currentLoadingMsgId = null; 

    try {
        const user = await checkUser(ctx);
        if (!user) return;

        // ===============================
        // 1. SETTINGS & CEK SALDO
        // ===============================
        // 🔥 Pengecekan limit 1 order aktif dihilangkan di sini

        const { data: settings } = await supabase
            .from('settings')
            .select('*');

        const hGrab = parseInt(settings?.find(s => s.key === 'harga_grab_multi')?.value || 3000);
        const hOvo = parseInt(settings?.find(s => s.key === 'harga_ovo_multi')?.value || 3000);
        const hargaTotal = hGrab + hOvo;

        if (user.balance < hargaTotal) {
            return ctx.answerCbQuery(
                "❌ Saldo Anda tidak cukup untuk membeli layanan ini!",
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 2. LOGIKA ANTI-TIMPA: KIRIM LOADING BARU
        // ===============================
        await ctx.deleteMessage().catch(()=>{});

        const loadingMsg = await ctx.reply(
            "⏳ *Sedang mengambil nomor multiservice\\.\\.\\.*",
            { parse_mode: 'MarkdownV2' }
        );
        currentLoadingMsgId = loadingMsg.message_id;

        await ctx.answerCbQuery().catch(()=>{});

        // ===============================
        // 3. API
        // ===============================
        let res;
        try {
            res = await axios.get(
                `https://vak-sms.com/api/getNumber/?apiKey=${process.env.VAK_SMS_API_KEY}&service=ga,oo&country=id&operator=${operator}`,
                { timeout: 5000 }
            );
        } catch {
            return bot.telegram.editMessageText(
                ctx.chat.id,
                currentLoadingMsgId,
                null,
                "❌ Gagal terhubung ke server pusat\\.",
                { 
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_multi' }]]
                    }
                }
            ).catch(()=>{});
        }

        // ===============================
        // 4. SUCCESS
        // ===============================
        if (Array.isArray(res.data) && res.data.length > 1) {

            const num = res.data[0].tel;
            const dGrab = res.data.find(x => x.service === 'ga');
            const dOvo = res.data.find(x => x.service === 'oo');

            const startTime = Date.now();
            const expiryTime = new Date(startTime + 1200000)
                .toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Jakarta',
                    hour12: false
                }).replace(/\./g, ':');

            const newBalance = user.balance - hargaTotal;

            await Promise.all([
                supabase.from('users')
                    .update({ balance: newBalance })
                    .eq('id', userId),

                supabase.from('orders_multi').insert([
                    {
                        id_num: dGrab.idNum,
                        user_id: userId,
                        service_name: 'Grab',
                        phone_number: num,
                        price_refund: hGrab,
                        status: 'active'
                    },
                    {
                        id_num: dOvo.idNum,
                        user_id: userId,
                        service_name: 'OVO',
                        phone_number: num,
                        price_refund: hOvo,
                        status: 'active'
                    }
                ])
            ]);

            const template = (layanan, harga) =>
`✅ *ORDER BERHASIL*

📦 Layanan : *${esc(layanan)}*
📱 Nomor : \`${esc(num)}\`
💰 Harga : ${esc(formatRp(harga))}
💵 Saldo : ${esc(formatRp(newBalance))}

📩 OTP CODE : Waiting For OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

            // 🔥 Hapus loading spesifik milik orderan ini
            await bot.telegram.deleteMessage(ctx.chat.id, currentLoadingMsgId).catch(()=>{});

            // 🔥 Kirim 2 Balon Chat Baru (Anti-Timpa)
            const msgGrab = await ctx.reply(template('Grab', hGrab), {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Batal / Refund', callback_data: `can_m_${dGrab.idNum}` }]
                    ]
                }
            });

            const msgOvo = await ctx.reply(template('OVO', hOvo), {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Batal / Refund', callback_data: `can_m_${dOvo.idNum}` }]
                    ]
                }
            });

            // Jalankan polling sesuai ID pesan masing-masing balon chat
            pollSMSMulti(userId, msgGrab.message_id, dGrab.idNum, "Grab", num, startTime, hGrab);
            pollSMSMulti(userId, msgOvo.message_id, dOvo.idNum, "OVO", num, startTime, hOvo);

        } 
        else {
            // 🔥 NO STOCK DENGAN TOMBOL KEMBALI
            await bot.telegram.editMessageText(
                ctx.chat.id,
                currentLoadingMsgId,
                null,
                "⚠️ *Stok Kosong*\nSilakan coba operator lain atau hubungi admin\\.",
                { 
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_multi' }]]
                    }
                }
            ).catch(()=>{});
        }

    } catch (e) {
        console.error('[MULTI EXEC ERROR]', e.message);
        if (currentLoadingMsgId) {
            await bot.telegram.editMessageText(
                ctx.chat.id, 
                currentLoadingMsgId, 
                null, 
                "❌ Terjadi kesalahan sistem\\.",
                { 
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'menu_multi' }]]
                    }
                }
            ).catch(()=>{});
        } else {
            ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(()=>{});
        }
    } finally {
        setTimeout(() => {
            activeTransactions.delete(userId);
        }, 2000);
    }
});

bot.action(/^more_m_(.+)$/, async (ctx) => {

    const idNum = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 1. ANTI SPAM / DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx); 

        // ===============================
        // 2. QUERY DB & SECURITY FIX
        // ===============================
        const { data: ord } = await supabase
            .from('orders_multi')
            .select('*')
            .eq('id_num', idNum)
            .eq('user_id', userId) 
            .maybeSingle();

        // ===============================
        // 3. VALIDASI 
        // ===============================
        if (!ord || ord.status !== 'active') {
            return ctx.answerCbQuery(
                "❌ Order tidak aktif atau tidak ditemukan.",
                { show_alert: true }
            ).catch(()=>{});
        }

        // ❌ JANGAN EDIT PESAN & JANGAN JAWAB CALLBACK DI SINI!
        // Biarkan tombol Telegram loading (spinner) berputar otomatis.

        // ===============================
        // 4. API REQUEST (TIMEOUT 8 DETIK)
        // ===============================
        let res;
        try {
            res = await axios.get(
                `https://vak-sms.com/api/setStatus/?apiKey=${process.env.VAK_SMS_API_KEY}&status=send&idNum=${idNum}`,
                { timeout: 8000 } // 🔥 Waktu ideal agar Telegram tidak mutus duluan
            );
        } catch {
            // 🔥 POPUP ERROR KONEKSI (UI lama & tombol tetap utuh)
            return ctx.answerCbQuery(
                "❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Request SMS.", 
                { show_alert: true }
            ).catch(()=>{});
        }

        if (res.data.status !== 'ready') {
            // 🔥 POPUP ERROR PROVIDER
            return ctx.answerCbQuery(
                `⚠️ Gagal request SMS baru: ${res.data.error || 'Server menolak'}`, 
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 5. SUCCESS - MATIKAN LOADING TOMBOL
        // ===============================
        await ctx.answerCbQuery("✅ Berhasil meminta SMS baru...").catch(()=>{});

        // ===============================
        // 6. HITUNG EXPIRY (Tanpa Detik)
        // ===============================
        const startTime = new Date(ord.created_at).getTime();

        const expiryTime = new Date(startTime + 1200000)
            .toLocaleTimeString('id-ID', {
                timeZone: 'Asia/Jakarta',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\./g, ':');

        // ===============================
        // 7. MESSAGE SUCCESS (Baru Edit UI)
        // ===============================
        const msgWaiting = `⏳ *MENUNGGU SMS BARU*

📦 Layanan : *${esc(ord.service_name)}*
📱 Nomor : \`${esc(ord.phone_number)}\`

📩 OTP CODE : \`${esc(ord.sms_code || '-')}\`
📩 Status : Waiting For New OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        // 🔥 FIX: Hapus reply_markup agar tidak ada tombol Batal/Refund
        await ctx.editMessageText(msgWaiting, {
            parse_mode: 'MarkdownV2'
        }).catch(()=>{});

        // ===============================
        // 8. POLLING ULANG
        // ===============================
        pollSMSMulti(
            userId, 
            ctx.callbackQuery.message.message_id,
            idNum,
            ord.service_name,
            ord.phone_number,
            startTime,
            ord.price_refund,
            ord.sms_code
        );

    } catch (e) {
        console.error('[MORE MULTI ERROR]', e.message);
        
        // 🔥 Popup untuk error sistem fatal agar UI tidak hancur
        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{});
        } catch(err){}
    } finally {
        activeTransactions.delete(userId);
    }
});

// SAAT TOMBOL DEPOSIT DIKLIK
bot.action('menu_deposit', async (ctx) => {
    const text = `💰 *PILIH NOMINAL DEPOSIT*\n\nSilakan pilih nominal deposit instan di bawah ini, atau gunakan Nominal Kustom:`;
    
    const buttons = [
        [
            Markup.button.callback("Rp 1.000", "depo_1000"),
            Markup.button.callback("Rp 5.000", "depo_5000")
        ],
        [
            Markup.button.callback("Rp 10.000", "depo_10000"),
            Markup.button.callback("Rp 25.000", "depo_25000")
        ],
        [
            Markup.button.callback("Rp 50.000", "depo_50000"),
            Markup.button.callback("Rp 100.000", "depo_100000")
        ],
        [Markup.button.callback("✏️ Nominal Kustom", "depo_kustom")],
        
        // 🔥 Menggunakan format raw khusus Main Menu
        [{ text: '🔙 Main Menu', callback_data: 'start' }] 
    ];

    try {
        // 🔥 Menggunakan editMessageText agar transisi menu mulus
        await ctx.editMessageText(text, { 
            parse_mode: "Markdown", 
            ...Markup.inlineKeyboard(buttons) 
        });
    } catch (e) {
        // Fallback jika edit gagal (misal karena isi pesan sama persis)
        if (!e.message.includes('message is not modified')) {
            await ctx.reply(text, { 
                parse_mode: "Markdown", 
                ...Markup.inlineKeyboard(buttons) 
            }).catch(() => {});
        }
    }
    
    // Pastikan membalas Callback Query agar ikon jam di tombol hilang
    await ctx.answerCbQuery().catch(() => {});
});

//Handler untuk Tombol Nominal Fix (Rp 1.000 - 100.000)
bot.action(/^depo_(\d+)$/, async (ctx) => {
    const amount = parseInt(ctx.match[1]);
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    try {
        // 1. Cek Maintenance TERLEBIH DAHULU sebelum menghapus pesan menu
        const { data: maint } = await supabase.from('system_settings').select('*').eq('setting_key', 'maintenance_deposit').maybeSingle();
        
        if (maint && maint.is_active) {
            // 🔥 Munculkan notifikasi pop-up (alert)
            return ctx.answerCbQuery(`⚠️ MAINTENANCE\n\n${maint.message}`, { show_alert: true }).catch(() => {});
        }

        // 2. Jika aman (tidak maintenance), baru hapus pesan dan pastikan state bersih
        userStates.delete(userId);
        await ctx.deleteMessage().catch(() => {});

        // 3. Kirim pesan loading
        const loadingMsg = await ctx.reply("⏳ Sedang membuat QRIS...");

        // 4. Jalankan background process
        setImmediate(() => {
            processQrisBackground(chatId, userId, amount, loadingMsg.message_id);
        });

    } catch (err) {
        console.error("Tombol Depo Error:", err);
        ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(() => {});
    }
});

//Handler untuk Tombol "Nominal Kustom"
bot.action('depo_kustom', async (ctx) => {
    const userId = ctx.from.id;
    
    // Set status user menjadi sedang mengisi nominal
    userStates.set(userId, 'WAITING_DEPOSIT');
    
    const text = "✏️ *NOMINAL KUSTOM*\n\nSilakan ketik angka nominal deposit yang Anda inginkan (tanpa titik/koma).\n\n_Minimal: Rp 1.000_\n_Maksimal: Rp 1.000.000_";
    
    // Gunakan editMessageText agar transisinya mulus (tidak hapus-kirim pesan)
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back", callback_data: "batal_kustom" }]]
        }
    }).catch(() => {});
});

// 🔥 Handler Batal Kustom (Kembali ke menu nominal)
bot.action('batal_kustom', async (ctx) => {
    const userId = ctx.from.id;
    
    // 1. Hapus status mengetik nominal agar bot tidak salah paham
    userStates.delete(userId);
    
    // 2. Tampilkan kembali menu deposit awal
    const text = `💰 *PILIH NOMINAL DEPOSIT*\n\nSilakan pilih nominal deposit instan di bawah ini, atau gunakan Nominal Kustom:`;
    
    const buttons = [
        [
            Markup.button.callback("Rp 1.000", "depo_1000"),
            Markup.button.callback("Rp 5.000", "depo_5000")
        ],
        [
            Markup.button.callback("Rp 10.000", "depo_10000"),
            Markup.button.callback("Rp 25.000", "depo_25000")
        ],
        [
            Markup.button.callback("Rp 50.000", "depo_50000"),
            Markup.button.callback("Rp 100.000", "depo_100000")
        ],
        [Markup.button.callback("✏️ Nominal Kustom", "depo_kustom")],
        
        // 🔥 Khusus tombol back diubah sesuai format permintaanmu
        [{ text: '🔙 Main Menu', callback_data: 'start' }] 
    ];

    try {
        await ctx.editMessageText(text, { 
            parse_mode: "Markdown", 
            ...Markup.inlineKeyboard(buttons) 
        });
    } catch (e) {
        if (!e.message.includes('message is not modified')) {
            await ctx.reply(text, { 
                parse_mode: "Markdown", 
                ...Markup.inlineKeyboard(buttons) 
            }).catch(() => {});
        }
    }
    
    ctx.answerCbQuery().catch(() => {});
});

// SAAT TOMBOL KEMBALI DIKLIK
bot.action('start', async (ctx) => {

    await ctx.answerCbQuery().catch(() => {});

    const user = await checkUser(ctx);
    if (!user) return;

    userStates.delete(ctx.from.id);

    // tampilkan menu utama
});

bot.command('miniapp', async (ctx) => {
    if (!MINI_APP_URL) {
        return ctx.reply('MINI_APP_URL belum diisi di env bot.');
    }

    return ctx.reply('Buka Mochi OTP lewat tombol di bawah ini.', {
        reply_markup: getMainMenuKeyboard([]),
    });
});

let cacheServices = {
  1: [],
  2: [],
  3: [], 
  4: []
};

let lastServiceUpdate = {
  1: 0,
  2: 0,
  3: 0,
  4: 0
};

const CACHE_DURATION = 1 * 60000; // 1 menit

// --- MENU LAYANAN BERDASARKAN SERVER ---
async function generateServiceMenu(ctx, page = 0, server = 1) {

    // 🔥 WAJIB: cek user (anti banned bypass)
    const user = await checkUser(ctx);
    if (!user) return;

    // 🔥 VALIDASI SERVER
    server = Number(server);
    if (![1, 2, 3, 4].includes(server)) {
        console.log("❌ INVALID SERVER:", server);
        return ctx.answerCbQuery("Server tidak valid").catch(()=>{});
    }

    // 🔥 INIT CACHE (Otomatis & Anti-Error)
    if (typeof cacheServices === 'undefined') cacheServices = {};
    if (!cacheServices[server]) cacheServices[server] = [];
    
    if (typeof lastServiceUpdate === 'undefined') lastServiceUpdate = {};
    if (!lastServiceUpdate[server]) lastServiceUpdate[server] = 0;

    const now = Date.now();
    const CACHE_DURATION = 60000; 

    // ===============================
    // FETCH DATA
    // ===============================
    if (!cacheServices[server].length || (now - lastServiceUpdate[server]) > CACHE_DURATION) {
        console.log(`📦 Mengambil layanan Server ${server}...`);

        let finalData = [];
        
        // 🔥 DAFTAR PRIORITAS (Dipakai oleh Server 1 dan 3)
        const priorityList = ['whatsapp', 'telegram', 'shopee', 'tiktok', 'facebook', 'instagram', 'gmail', 'vercel', 'uangme', 'claude', 'dana', 'gojek', 'ovo', 'kopi kenangan', 'tokopedia', 'lazada', 'discord', 'openai', 'paypal', 'fore', 'tomoro', 'redbook', 'meta', 'starbucks'];

        if (server === 1) {
            // 🔥 STRATEGI BARU: Filter Layanan yang BENAR-BENAR support Indonesia (ID 6)
            try {
                const bowerPriceUrl = `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getPrices&country=6`;
                const resPrice = await axios.get(bowerPriceUrl, { timeout: 15000 });

                const countryData = resPrice.data?.["6"] || resPrice.data?.[6];

                if (countryData && typeof countryData === 'object') {
                    const availableCodes = Object.keys(countryData);

                    const bowerServiceUrl = `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getServicesList`;
                    const resService = await axios.get(bowerServiceUrl, { timeout: 10000 });

                    if (resService.data && resService.data.status === "success") {
                        const allServices = resService.data.services;

                        finalData = allServices
                            .filter(s => availableCodes.includes(s.code))
                            .map(s => ({
                                id: s.code,
                                name: s.name,
                                price: 0,
                                isVak: false,
                                isSmscode: false,
                                isBower: true
                            }));

                        finalData.sort((a, b) => {
                            const nameA = a.name.toLowerCase();
                            const nameB = b.name.toLowerCase();
                            let prioA = 999;
                            let prioB = 999;
                            priorityList.forEach((keyword, index) => {
                                if (nameA.includes(keyword) && prioA === 999) prioA = index;
                                if (nameB.includes(keyword) && prioB === 999) prioB = index;
                            });
                            if (prioA !== prioB) return prioA - prioB;
                            return a.name.localeCompare(b.name);
                        });
                    }
                } else {
                    return ctx.reply("❌ Server 1: Tidak ada layanan tersedia untuk Indonesia saat ini.");
                }
            } catch (err) {
                console.error("❌ Error API SMSBower S1 filtered:", err.message);
                return ctx.reply("❌ Terjadi kesalahan saat memproses layanan Server 1.");
            }

        } else if (server === 2) {
            // 🔥 SERVER 2 (TELEGRAM LUAR NEGERI)
            try {
                const res = await axios.get("https://api.smscode.gg/v1/catalog/countries", {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                    timeout: 10000 
                });

                if (res.data && res.data.success) {
                    // Ambil negara aktif DAN buang Indonesia
                    const activeCountries = res.data.data.filter(c => 
                        c.active === true && c.name.toLowerCase() !== 'indonesia'
                    );
                    
                    finalData = activeCountries.map(c => ({
                        id: c.id,       
                        name: `${c.emoji} ${c.name}`, 
                        price: 0,       
                        isVak: false, 
                        isSmscode: false, 
                        isTeleLuar: true // 🔥 Flag baru khusus Telegram Luar Server 2
                    }));
                } else {
                    return ctx.reply("❌ Gagal mengambil daftar negara dari pusat.");
                }
            } catch (err) {
                console.error("❌ Error API SMSCode S2:", err.message);
                return ctx.reply("❌ Terjadi kesalahan saat menghubungi server pusat.");
            }

        } else if (server === 3) {
            // 🔥 SERVER 3 (SMSCode - Country ID 7)
            try {
                const res = await axios.get("https://api.smscode.gg/v1/catalog/services?country_id=7", {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                    timeout: 10000 
                });

                if (res.data && res.data.success) {
                    const activeServices = res.data.data.filter(s => s.active === true);
                    finalData = activeServices.map(s => ({
                        id: s.id,       
                        name: s.name,
                        price: 0,       
                        isVak: false, 
                        isSmscode: true 
                    }));

                    finalData.sort((a, b) => {
                        const nameA = a.name.toLowerCase();
                        const nameB = b.name.toLowerCase();
                        let prioA = 999;
                        let prioB = 999;
                        priorityList.forEach((keyword, index) => {
                            if (nameA.includes(keyword) && prioA === 999) prioA = index;
                            if (nameB.includes(keyword) && prioB === 999) prioB = index;
                        });
                        if (prioA !== prioB) return prioA - prioB; 
                        return a.name.localeCompare(b.name);
                    });
                } else {
                    return ctx.reply("❌ Gagal mengambil daftar layanan Server 3.");
                }
            } catch (err) {
                console.error("❌ Error API SMSCode S3:", err.message);
                return ctx.reply("❌ Gagal menghubungi server pusat Server 3.");
            }

        } else if (server === 4) {
            // 🔥 SERVER 4 (WA LUAR NEGERI)
            try {
                const res = await axios.get("https://api.smscode.gg/v1/catalog/countries", {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                    timeout: 10000 
                });

                if (res.data && res.data.success) {
                    const activeCountries = res.data.data.filter(c => 
                        c.active === true && c.name.toLowerCase() !== 'indonesia'
                    );
                    
                    finalData = activeCountries.map(c => ({
                        id: c.id,       
                        name: `${c.emoji} ${c.name}`, 
                        price: 0,       
                        isVak: false, 
                        isSmscode: false, 
                        isWaLuar: true 
                    }));
                } else {
                    return ctx.reply("❌ Gagal mengambil daftar negara dari pusat.");
                }
            } catch (err) {
                console.error("❌ Error API SMSCode S4:", err.message);
                return ctx.reply("❌ Terjadi kesalahan saat menghubungi server pusat.");
            }
        }

        cacheServices[server] = finalData;
        lastServiceUpdate[server] = now;
    }

    const services = cacheServices[server];

    // ===============================
    // HANDLE KOSONG / PAGINATION / BUTTONS
    // ===============================
    if (!services.length) {
        const text = `📦 *Silahkan pilih layanan OTP*\n\n🌐 *Server : Server ${server}*\n\n⚠️ Tidak ada layanan tersedia untuk server ini\\.`;
        return ctx.editMessageText(text, {
            parse_mode: "MarkdownV2",
            ...Markup.inlineKeyboard([[Markup.button.callback("⬅ Pilih Server", "menu_otp")]])
        }).catch(()=>{});
    }

    const perPage = 16;
    page = Number(page);
    if (isNaN(page) || page < 0) page = 0;
    const totalPage = Math.max(1, Math.ceil(services.length / perPage));
    if (page >= totalPage) page = totalPage - 1;

    const start = page * perPage;
    const pageServices = services.slice(start, start + perPage);
    const buttons = [];

    for (let i = 0; i < pageServices.length; i += 2) {
        const row = [];
        const getCallback = (s) => {
            if (s.isSmscode) {
                const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                return `smscode_list_${safeName}_${s.id}`;
            }
            if (s.isBower) return `list_srv1_${s.id}`;
            if (s.isWaLuar) {
                const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                return `waluar_list_${safeName}_${s.id}`; 
            }
            if (s.isTeleLuar) {
                // 🔥 Arahkan tombol negara Server 2 ke menu harga Telegram Luar
                const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                return `teleluar_list_${safeName}_${s.id}`; 
            }
            if (server === 1 && !s.isVak) return `list_srv1_${s.id}`;
            return s.isVak ? `buy_vak_${server}_${s.id}` : `buy_${server}_${s.id}`;
        };

        const getButtonText = (s) => {
            // Karena Server 2 sekarang isinya daftar negara (bukan produk langsung), hilangkan teks harga
            if (server === 1 || server === 2 || server === 3 || server === 4) return s.name; 
            return `${s.name} - ${formatRp(s.price)}`; 
        };

        const s1 = pageServices[i];
        row.push(Markup.button.callback(getButtonText(s1), getCallback(s1)));
        if (pageServices[i + 1]) {
            const s2 = pageServices[i + 1];
            row.push(Markup.button.callback(getButtonText(s2), getCallback(s2)));
        }
        buttons.push(row);
    }

    const nav = [];
    if (page > 0) nav.push(Markup.button.callback("⬅ Prev", `page_${server}_${page - 1}`));
    nav.push(Markup.button.callback(`${page + 1}/${totalPage}`, "ignore"));
    if (page < totalPage - 1) nav.push(Markup.button.callback("Next ➡", `page_${server}_${page + 1}`));
    buttons.push(nav);

    buttons.push([
        Markup.button.callback("🔍 Search", `search_srv_${server}`),
        Markup.button.callback("⬅ Back", "menu_otp")
    ]);

    let serverInfo = "";
    if (server === 1) serverInfo = "⚡ Nomor OTP Indonesia dengan kualitas premium dan stok melimpah\\.";
    else if (server === 2) serverInfo = "🌍 *Server Telegram Luar Negeri*: Server khusus Telegram negara di luar Indonesia\\."; // 🔥 Deskripsi baru
    else if (server === 3) serverInfo = "✉️ *Server Full Text*: Menampilkan isi pesan SMS secara utuh tanpa filter kode\\.";
    else if (server === 4) serverInfo = "🌍 *Server WA Luar Negeri*: Server khusus WhatsApp negara di luar Indonesia\\."; 

    const text = `📦 *PILIH LAYANAN OTP*\n\n🌐 *Server : Server ${server}*\n\n${serverInfo}`;

    try {
        await ctx.editMessageText(text, {
            parse_mode: "MarkdownV2",
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (e) {
        if (!e.message.includes('message is not modified')) {
            await ctx.reply(text, { parse_mode: "MarkdownV2", ...Markup.inlineKeyboard(buttons) });
        }
    }
}

// ==========================================
// HANDLE KLIK TOMBOL SEARCH (Clean UI)
// ==========================================
bot.action(/^search_srv_(.+)$/, async (ctx) => {
    try {
        const server = ctx.match[1];
        await ctx.answerCbQuery().catch(() => {});
        
        // Simpan status bahwa user ini sedang mencari, dan simpan ID Pesan menunya
        activeSearch[ctx.from.id] = {
            server: Number(server),
            menuMsgId: ctx.callbackQuery.message.message_id
        };
        
        let textPrompt = `🔍 *Pencarian Server ${server}*\n\nSilakan ketik nama layanan yang ingin dicari (Contoh: Shopee, WhatsApp) langsung di obrolan ini:`;
        
        // 🔥 UPDATE: Server 2 (Tele Luar) dan Server 4 (WA Luar) menggunakan pencarian berdasarkan NEGARA
        if (server === '2' || server === '4') {
            textPrompt = `🔍 *Pencarian Server ${server}*\n\nSilakan ketik nama negara yang ingin dicari (Contoh: Vietnam, China) langsung di obrolan ini:`;
        }

        // 🔥 EDIT pesan menu menjadi prompt pencarian
        return ctx.editMessageText(textPrompt, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback("❌ Batal", `page_${server}_0`)]
                ]
            }
        }).catch(()=>{});

    } catch (e) {
        console.error("❌ Error action search:", e);
    }
});

// ==========================================
// HANDLE TEXT BALASAN (Pencarian Layanan) - Clean UI
// ==========================================
bot.on('text', async (ctx, next) => {
    try {
        const userId = ctx.from.id;

        // Cek apakah user sedang dalam mode pencarian
        if (activeSearch[userId]) {
            const keyword = ctx.message.text.toLowerCase();
            const { server, menuMsgId } = activeSearch[userId];

            // Batalkan pencarian otomatis jika user malah mengetik command (misal /start)
            if (keyword.startsWith('/')) {
                delete activeSearch[userId];
                return next();
            }

            // 🔥 1. Hapus chat yang diketik user biar room tetap bersih
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            // Selesai mencari, hapus status pencariannya agar normal kembali
            delete activeSearch[userId];

            if (typeof cacheServices === 'undefined' || !cacheServices[server]) {
                return ctx.telegram.editMessageText(ctx.chat.id, menuMsgId, undefined, "⚠️ Database belum siap.", {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("⬅ Kembali", `page_${server}_0`)]] }
                }).catch(()=>{});
            }

            const allServices = cacheServices[server] || [];
            const filtered = allServices.filter(s => s.name.toLowerCase().includes(keyword));

            // Jika hasil KOSONG
            if (filtered.length === 0) {
                let errorText = `❌ *${ctx.message.text}* tidak ditemukan di Server ${server}.`;
                return ctx.telegram.editMessageText(ctx.chat.id, menuMsgId, undefined, errorText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [Markup.button.callback("🔍 Coba Lagi", `search_srv_${server}`)],
                            [Markup.button.callback("⬅ Kembali ke Menu", `page_${server}_0`)]
                        ]
                    }
                }).catch(()=>{});
            }

            // Jika DITEMUKAN: Susun tombol
            const buttons = [];
            for (let i = 0; i < filtered.length; i += 2) {
                const row = [];
                
                // 🔥 PERBAIKAN: Arahkan callback agar mengenali Telegram Luar (Server 2)
                const getCb = (s) => {
                    if (s.isSmscode) {
                        const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                        return `smscode_list_${safeName}_${s.id}`;
                    }
                    if (s.isWaLuar) {
                        const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                        return `waluar_list_${safeName}_${s.id}`; 
                    }
                    if (s.isTeleLuar) {
                        // 🔥 TAMBAHAN BARU: Arahkan hasil cari Server 2 ke menu harga Telegram
                        const safeName = s.name.replace(/\s/g, '').substring(0, 20);
                        return `teleluar_list_${safeName}_${s.id}`; 
                    }
                    if (server === 1 && !s.isVak) {
                        return `list_srv1_${s.id}`; 
                    }
                    return s.isVak ? `buy_vak_${server}_${s.id}` : `buy_${server}_${s.id}`;
                };

                // 🔥 PERBAIKAN: Sembunyikan harga untuk Server 1, 2, 3, dan 4
                const getBtnText = (s) => {
                    // 🔥 TAMBAHAN BARU: Masukkan server === 2 ke sini
                    if (server === 1 || server === 2 || server === 3 || server === 4) {
                        return s.name; // Cuma nama
                    } else {
                        const priceStr = typeof formatRp === 'function' ? formatRp(s.price) : `Rp ${s.price}`;
                        return `${s.name} - ${priceStr}`; // Nama + Harga
                    }
                };
                
                const s1 = filtered[i];
                row.push(Markup.button.callback(getBtnText(s1), getCb(s1)));
                
                if (filtered[i+1]) {
                    const s2 = filtered[i+1];
                    row.push(Markup.button.callback(getBtnText(s2), getCb(s2)));
                }
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("⬅ Kembali ke Menu", `page_${server}_0`)]);

            let successText = `✅ Ditemukan ${filtered.length} hasil untuk "*${ctx.message.text}*":`;

            // 🔥 2. EDIT menu utama menjadi hasil pencarian
            return ctx.telegram.editMessageText(ctx.chat.id, menuMsgId, undefined, successText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            }).catch(()=>{});
        }

        // Lanjut ke handle lain jika user tidak sedang mencari
        return next();
        
    } catch (e) {
        console.error("❌ Error handler search:", e);
        return next();
    }
});

bot.action('menu_otp', async (ctx) => {

    // 🔥 WAJIB: jawab callback dulu
    await ctx.answerCbQuery().catch(() => {});

    const text =
`⚡ *PILIH SERVER OTP*
━━━━━━━━━━━━━━━━━━━━

🚀 *SERVER 1 — HIGH STOCK*
Server utama dengan stok nomor dalam jumlah besar dan performa stabil\\.

🌍 *SERVER 2 — TELEGRAM LUAR NEGERI*
Server khusus untuk layanan Telegram berbagai negara di luar Indonesia\\.

✉️ *SERVER 3 — FULL TEXT*
Server khusus yang menampilkan isi pesan SMS secara utuh tanpa filter kode\\.

🌍 *SERVER 4 — WA LUAR NEGERI*
Server khusus untuk layanan WhatsApp berbagai negara di luar Indonesia\\.

Silakan pilih server melalui tombol di bawah ini :`;

    await ctx.editMessageText(text, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Server 1 | High Stock', callback_data: 'server1' }],
                [{ text: '🌍 Server 2 | Tele Luar Negeri', callback_data: 'server2' }],
                [{ text: '✉️ Server 3 | Full Text', callback_data: 'server3' }],
                [{ text: '🌍 Server 4 | WA Luar Negeri', callback_data: 'server_wa_luar' }],
                [{ text: '🔙 Main Menu', callback_data: 'start' }]
            ]
        }
    }).catch((e) => console.error("Error Menu OTP:", e.message));
});

bot.action('server1', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {}); // 🔥 tambahkan catch
    await generateServiceMenu(ctx, 0, 1);
});

bot.action('server2', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {}); // 🔥 tambahkan catch
    await generateServiceMenu(ctx, 0, 2);
});

bot.action('server3', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await generateServiceMenu(ctx, 0, 3);
});

bot.action('server_wa_luar', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await generateServiceMenu(ctx, 0, 4);
});

bot.command('update', async (ctx) => {

    // 🔒 CEK ADMIN (SILENT)
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    cacheServices = {
        1: [],
        2: [],
        3: [], 
        4: []
    };

    lastServiceUpdate = {
        1: 0,
        2: 0,
        3: 0,
        4: 0
    };

    ctx.reply("🔄 Cache layanan (Server 1, 2, 3, & 4) berhasil diperbarui.");
});

bot.action(/page_(.+)/, async (ctx) => {

    // 🔥 WAJIB: jawab callback dulu
    await ctx.answerCbQuery().catch(() => {});

    try {
        const data = ctx.match[1].split("_");

        const server = parseInt(data[0]);
        const page = parseInt(data[1]);

        // optional: loading biar smooth
        // ctx.editMessageText("⏳ Memuat halaman...").catch(()=>{});

        await generateServiceMenu(ctx, page, server);

    } catch (e) {
        console.error('[PAGE ERROR]', e.message);
    }
});


bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
});

async function fetchSmsBowerPricesV3(serviceCode, country) {
    const endpoints = [
        'https://smsbower.page/stubs/handler_api.php',
        'https://smsbower.app/stubs/handler_api.php'
    ];

    let lastError;

    for (const endpoint of endpoints) {
        try {
            const res = await axios.get(endpoint, {
                params: {
                    api_key: process.env.SMSBOWER_API_KEY,
                    action: 'getPricesV3',
                    service: String(serviceCode).toLowerCase(),
                    country: String(country)
                },
                timeout: 20000,
                maxRedirects: 5,
                decompress: true,
                responseType: 'text',
                transformResponse: [(data) => data],
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            const raw = typeof res.data === 'string'
                ? res.data.replace(/^\uFEFF/, '').trim()
                : res.data;

            if (!raw) {
                throw new Error(`Respon kosong dari ${endpoint}`);
            }

            let parsed = raw;

            if (typeof raw === 'string') {
                if (!raw.startsWith('{') && !raw.startsWith('[')) {
                    throw new Error(`Respon bukan JSON dari ${endpoint}: ${raw.slice(0, 150)}`);
                }

                try {
                    parsed = JSON.parse(raw);
                } catch (err) {
                    throw new Error(`Gagal parse JSON dari ${endpoint}: ${err.message}`);
                }
            }

            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`Format respon tidak valid dari ${endpoint}`);
            }

            return parsed;
        } catch (err) {
            lastError = err;
            console.error(`[SMSBOWER] Endpoint gagal: ${endpoint} -> ${err.message}`);
        }
    }

    throw lastError || new Error('Semua endpoint SMSBower gagal.');
}

// 🔥 PERBAIKAN: Regex diubah untuk menangkap Huruf, Angka, dan Karakter Khusus
bot.action(/^list_srv1_([a-zA-Z0-9_]+)$/, async (ctx) => {
    const serviceCode = ctx.match[1].toLowerCase(); 
    const country = '6'; // Server 1 fix Indonesia (ID 6)
    
    // 🔥 PERBAIKAN 1: Tombol kembali mengarah ke menu daftar layanan Server 1
    const backButton = [Markup.button.callback('⬅️ Kembali', 'server1')]; 

    try {
        // 🔥 PERBAIKAN 2: Hanya gunakan notifikasi popup, hapus loading "Mencari stok..." agar transisi mulus
        await ctx.answerCbQuery("🔍 Mengambil data harga dari pusat...").catch(() => {});

        // 🔥 PERBAIKAN NAMA: Ambil nama asli dari Memory Cache (Sangat Ringan)
        let serviceName = `Layanan ${serviceCode.toUpperCase()}`; // Fallback default
        if (typeof cacheServices !== 'undefined' && cacheServices[1]) {
            const foundService = cacheServices[1].find(s => String(s.id).toLowerCase() === serviceCode);
            if (foundService && foundService.name) {
                serviceName = foundService.name; 
            }
        }

        let profit = 600;
        if (serviceCode === 'wa' || serviceCode === 'tg') {
            profit = 1000;
        }

        // 1. Ambil harga terbaru dari SMSBower
        const data = await fetchSmsBowerPricesV3(serviceCode, country);

        const providersObj =
            data?.[country]?.[serviceCode] ||
            data?.[Number(country)]?.[serviceCode] ||
            null;

        if (!providersObj || typeof providersObj !== 'object' || Array.isArray(providersObj)) {
            console.error('[LIST_SRV1] Format providers tidak valid:', providersObj);
            return ctx.editMessageText("⚠️ Stok layanan ini sedang kosong di server pusat.", {
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(() => {});
        }

        const rate =
            typeof currentUsdtToIdr !== 'undefined' && Number.isFinite(currentUsdtToIdr)
                ? currentUsdtToIdr
                : 17500;

        const groupedMap = {};

        // 2. Gabungkan provider dengan harga yang sama
        for (const [provKey, providerData] of Object.entries(providersObj)) {
            const usdPrice = Number(providerData?.price);
            const stock = Number(providerData?.count);
            const providerId = String(providerData?.provider_id ?? provKey);

            if (!providerId || !Number.isFinite(usdPrice) || !Number.isFinite(stock)) {
                continue;
            }

            if (stock <= 20) continue;

            const priceKey = usdPrice.toFixed(3);

            if (!groupedMap[priceKey]) {
                groupedMap[priceKey] = {
                    usdPrice,
                    stock: 0,
                    providerIds: [],
                    idrPrice: Math.round(usdPrice * rate) + profit
                };
            }

            groupedMap[priceKey].stock += stock;
            groupedMap[priceKey].providerIds.push(providerId);
        }

        // 3. Urutkan harga dari yang termurah
        // 🔥 PERBAIKAN 3: Ambil 16 opsi terbaik (berarti akan ada 8 baris kiri-kanan)
        const priceList = Object.values(groupedMap)
            .sort((a, b) => a.usdPrice - b.usdPrice)
            .slice(0, 16); 

        if (priceList.length === 0) {
            return ctx.editMessageText("⚠️ Stok saat ini sedang kosong atau di bawah 20.", {
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(() => {});
        }

        // ========================================================
        // 4. SUSUN TOMBOL JADI 2 KOLOM
        // ========================================================
        const buttons = [];

        for (let i = 0; i < priceList.length; i += 2) {
            const row = [];

            // Tombol Kolom Kiri
            const itemLeft = priceList[i];
            const formattedPriceLeft = formatRp(itemLeft.idrPrice).replace("Rp ", "Rp. ");
            row.push(
                Markup.button.callback(
                    `${formattedPriceLeft} | Stok ${itemLeft.stock}`,
                    `buy1_${itemLeft.idrPrice}_${serviceCode}_${itemLeft.usdPrice.toFixed(3)}`
                )
            );

            // Tombol Kolom Kanan (Hanya dimasukkan jika datanya genap/ada)
            if (priceList[i + 1]) {
                const itemRight = priceList[i + 1];
                const formattedPriceRight = formatRp(itemRight.idrPrice).replace("Rp ", "Rp. ");
                row.push(
                    Markup.button.callback(
                        `${formattedPriceRight} | Stok ${itemRight.stock}`,
                        `buy1_${itemRight.idrPrice}_${serviceCode}_${itemRight.usdPrice.toFixed(3)}`
                    )
                );
            }

            buttons.push(row);
        }

        // Masukkan tombol kembali di baris paling bawah secara full-width
        buttons.push(backButton);

        const message =
            `✨ *LAYANAN TERPILIH: ${serviceName}*\n\n` +
            `Berikut adalah pilihan harga yang tersedia saat ini.\n\n` +
            `_Pilih harga yang menurut Anda paling stabil:_`;

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: buttons
            }
        }).catch((err) => {
            console.error('[LIST_SRV1] Gagal edit message:', err.message);
        });

    } catch (e) {
        console.error('[LIST_SRV1 ERROR]', e.message);
        await ctx.editMessageText("❌ Koneksi ke pusat sedang gangguan.", {
            reply_markup: { inline_keyboard: [backButton] }
        }).catch(() => {});
    }
});

// 🔥 KHUSUS SERVER 1: Handler untuk tombol pilihan harga dinamis
async function requestSmsBowerNumber({ serviceCode, country, providerIds, maxPriceUsd }) {
    const endpoints = [
        'https://smsbower.page/stubs/handler_api.php',
        'https://smsbower.app/stubs/handler_api.php'
    ];

    let lastError;

    for (const endpoint of endpoints) {
        try {
            const res = await axios.get(endpoint, {
                params: {
                    api_key: process.env.SMSBOWER_API_KEY,
                    action: 'getNumber',
                    service: String(serviceCode).toLowerCase(),
                    country: String(country),
                    providerIds: String(providerIds),
                    ...(maxPriceUsd ? { maxPrice: String(maxPriceUsd) } : {})
                },
                timeout: 20000,
                maxRedirects: 5,
                decompress: true,
                responseType: 'text',
                transformResponse: [(data) => data],
                headers: {
                    Accept: 'text/plain, application/json, */*',
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            const raw = typeof res.data === 'string'
                ? res.data.replace(/^\uFEFF/, '').trim()
                : String(res.data || '').trim();

            if (!raw) {
                throw new Error(`Respon kosong dari ${endpoint}`);
            }

            return raw;
        } catch (err) {
            lastError = err;
            console.error(`[SMSBOWER][getNumber] ${endpoint} -> ${err.message}`);
        }
    }

    throw lastError || new Error('Semua endpoint SMSBower gagal.');
}

bot.action(/^buy1_(\d+)_([a-zA-Z0-9_]+)_([\d.]+)$/, async (ctx) => {
    // 1. TANGKAP DATA DARI TOMBOL (Perhatikan: match[2] sekarang bisa menangkap huruf)
    const finalPriceIdr = parseInt(ctx.match[1], 10);
    const serviceCode = ctx.match[2]; // Kode API SMSBower (contoh: 'wa', 'kt')
    const selectedUsdPrice = Number(ctx.match[3]);
    
    const userId = ctx.from.id;
    const country = '6'; // 🔥 Kunci ke ID 6 (Indonesia) untuk Server 1
    let currentLoadingId = null;

    try {
        if (activeTransactions.has(userId)) {
            return ctx.answerCbQuery("⏳ Sedang diproses...", {
                show_alert: true
            }).catch(() => {});
        }

        activeTransactions.add(userId);

        const user = await checkUser(ctx);
        if (!user) return;

        // 🔥 PERBAIKAN: Ambil Nama Layanan dari teks pesan (Tanpa Database)
        const msgText = ctx.callbackQuery.message.text || "";
        const nameMatch = msgText.match(/LAYANAN TERPILIH:\s*(.+)/i);
        const serviceName = nameMatch ? nameMatch[1].trim() : `Layanan ${serviceCode.toUpperCase()}`;

        if (!Number.isFinite(finalPriceIdr) || !Number.isFinite(selectedUsdPrice) || !serviceCode) {
            return ctx.answerCbQuery("❌ Data order tidak valid!", {
                show_alert: true
            }).catch(() => {});
        }

        if (user.balance < finalPriceIdr) {
            return ctx.answerCbQuery(
                `❌ Saldo Anda tidak cukup!\nHarga: ${formatRp(finalPriceIdr)}`,
                { show_alert: true }
            ).catch(() => {});
        }

        await ctx.deleteMessage().catch(() => {});

        const loadingMsg = await ctx.reply(
            "⏳ *Sedang memproses permintaan nomor\\.\\.\\.*",
            { parse_mode: 'MarkdownV2' }
        );

        currentLoadingId = loadingMsg.message_id;
        await ctx.answerCbQuery().catch(() => {});

        // 2. FETCH ULANG HARGA API (Menggunakan variabel serviceCode & country)
        const data = await fetchSmsBowerPricesV3(serviceCode, country);

        const providersObj =
            data?.[country]?.[serviceCode] ||
            data?.[Number(country)]?.[serviceCode] ||
            null;

        if (!providersObj || typeof providersObj !== 'object' || Array.isArray(providersObj)) {
            throw new Error('Format data provider tidak valid atau stok kosong');
        }

        // 3. FILTER PROVIDER DENGAN HARGA YANG SAMA
        const targetPriceKey = selectedUsdPrice.toFixed(3);

        const samePriceProviders = Object.entries(providersObj)
            .map(([provKey, providerData]) => {
                const usdPrice = Number(providerData?.price);
                const stock = Number(providerData?.count);
                const providerId = String(providerData?.provider_id ?? provKey);

                if (!providerId || !Number.isFinite(usdPrice) || !Number.isFinite(stock)) {
                    return null;
                }

                return { providerId, usdPrice, stock };
            })
            .filter(item =>
                item &&
                item.stock > 0 &&
                item.usdPrice.toFixed(3) === targetPriceKey
            )
            .sort((a, b) => b.stock - a.stock);

        if (samePriceProviders.length === 0) {
            await bot.telegram.editMessageText(
                ctx.chat.id,
                currentLoadingId,
                null,
                "⚠️ *Harga yang dipilih sudah tidak tersedia*\nSilakan pilih harga lain\\.",
                {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali Pilih Harga', callback_data: `list_srv1_${serviceCode}` }]
                        ]
                    }
                }
            ).catch(() => {});
            return;
        }

        const providerIds = samePriceProviders.map(item => item.providerId).join(',');

        // 4. REQUEST NOMOR KE SMSBOWER
        const result = await requestSmsBowerNumber({
            serviceCode: serviceCode,
            country: country,
            providerIds,
            maxPriceUsd: selectedUsdPrice.toFixed(3)
        });

        // 5. PENANGANAN SUKSES & POTONG SALDO
        if (typeof result === 'string' && result.startsWith('ACCESS_NUMBER')) {
            const parts = result.split(':');
            const activationId = parts[1];
            const number = parts[2];

            if (!activationId || !number) {
                throw new Error(`Format ACCESS_NUMBER tidak valid: ${result}`);
            }

            const newBalance = user.balance - finalPriceIdr;

            const { error: userUpdateError } = await supabase
                .from('users')
                .update({ balance: newBalance })
                .eq('id', userId);

            if (userUpdateError) {
                throw new Error(`Gagal potong saldo: ${userUpdateError.message}`);
            }

            const { error: orderInsertError } = await supabase
                .from('orders')
                .insert({
                    user_id: userId,
                    service_name: serviceName, // Masukkan nama layanan yang didapat dari teks
                    phone_number: number,
                    activation_id: activationId,
                    price: finalPriceIdr,
                    status: 'active'
                });

            if (orderInsertError) {
                throw new Error(`Gagal menyimpan order: ${orderInsertError.message}`);
            }

            const startTime = Date.now();
            const durationLimit = 1500000;

            const expiryTime = new Date(startTime + durationLimit)
                .toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Jakarta',
                    hour12: false
                })
                .replace(/\./g, ':');

            await bot.telegram.deleteMessage(ctx.chat.id, currentLoadingId).catch(() => {});

            const sentMsg = await ctx.reply(
`✅ *ORDER BERHASIL*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${number}\`
💰 *Harga :* ${esc(formatRp(finalPriceIdr))}
💵 *Saldo :* ${esc(formatRp(newBalance))}

📩 *OTP CODE :* Waiting For OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`,
                {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Batal / Refund', callback_data: `st8_${activationId}` }]
                        ]
                    }
                }
            );

            pollSMS(userId, sentMsg.message_id, activationId, serviceName, number, startTime, null);
            return;
        }

        // 6. PENANGANAN ERROR PROVIDER
        if (result === 'NO_NUMBERS') {
            await bot.telegram.editMessageText(
                ctx.chat.id, currentLoadingId, null,
                "⚠️ *Semua provider pada harga ini sedang kosong*\nSilakan pilih harga lain\\.",
                {
                    parse_mode: 'MarkdownV2',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali Pilih Harga', callback_data: `list_srv1_${serviceCode}` }]] }
                }
            ).catch(() => {});
            return;
        }

        const errorMsgs = {
            'BAD_KEY': "❌ API key tidak valid.",
            'BAD_SERVICE': "❌ Service provider tidak valid.",
            'BAD_ACTION': "❌ Action API tidak valid."
        };

        if (errorMsgs[result]) {
            await bot.telegram.editMessageText(
                ctx.chat.id, currentLoadingId, null, errorMsgs[result],
                { reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `list_srv1_${serviceCode}` }]] } }
            ).catch(() => {});
            return;
        }

        await bot.telegram.editMessageText(
            ctx.chat.id, currentLoadingId, null, `❌ Gagal order: ${String(result || 'Unknown error')}`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `list_srv1_${serviceCode}` }]] } }
        ).catch(() => {});

    } catch (e) {
        console.error('[BUY1 ERROR]', e.message);

        if (currentLoadingId) {
            await bot.telegram.editMessageText(
                ctx.chat.id, currentLoadingId, null, "❌ Koneksi sibuk atau API Provider lambat merespons.",
                { reply_markup: { inline_keyboard: [[{ text: '🔙 Coba Lagi', callback_data: `list_srv1_${serviceCode}` }]] } }
            ).catch(() => {});
        } else {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(() => {});
        }
    } finally {
        setTimeout(() => {
            activeTransactions.delete(userId);
        }, 1500);
    }
});

/// TELEGRAM LUAR /////
async function pollTelegramLuar(
    chatId,
    messageId,
    activationId,
    serviceName,
    phoneNumber,
    startTime,
    lastSms = "",
    isResend = false
) {
    const DURATION_LIMIT = 20 * 60 * 1000; // 20 Menit

    try {
        // 🔥 1. CEK DATABASE LOKAL (Super Ringan)
        const { data: order, error: dbError } = await supabase
            .from("orders")
            .select("status, sms_code, price") 
            .eq("activation_id", activationId)
            .maybeSingle();

        if (dbError) {
            console.log(`[DEBUG-ERROR] Supabase Error:`, dbError.message);
            // Ulangi polling 10 detik lagi jika DB lokal lag, jangan dibunuh
            return setTimeout(() => pollTelegramLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
        }
        
        if (!order || order.status !== "active") return;

        const now = Date.now();
        const timeElapsed = now - startTime;

        // 🔥 FILTER UI: Hapus kata "Telegram " di awal kalimat agar UI konsisten menggunakan format "Negara :"
        const displayCountry = serviceName.replace(/^Telegram\s+/i, '');

        // ============================
        // ⏰ EXPIRED & ANTI-RUGI
        // ============================
        if (timeElapsed >= DURATION_LIMIT) {
            console.log(`⏰ [Telegram Luar] Waktu habis untuk nomor: ${phoneNumber}`); 

            let shouldRefund = false;
            let smsFound = order.sms_code || lastSms;

            // Kita hit API Pusat hanya untuk CANCEL order kalau expired
            try {
                const checkRes = await axios.get(
                    `https://api.smscode.gg/v1/orders/${activationId}`,
                    { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, timeout: 20000 }
                );

                if (checkRes.data && checkRes.data.success) {
                    const apiStatus = checkRes.data.data.status;
                    if (apiStatus === "EXPIRED" || apiStatus === "CANCELLED" || apiStatus === "TIMEOUT") {
                        shouldRefund = true;
                    } 
                    else if (apiStatus === "COMPLETED" || apiStatus === "OTP_RECEIVED" || checkRes.data.data.otp_code) {
                        shouldRefund = false;
                        smsFound = true;
                    } 
                    else {
                        const cancelRes = await axios.post(
                            "https://api.smscode.gg/v1/orders/cancel",
                            { id: parseInt(activationId) },
                            { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, timeout: 20000 }
                        );
                        if (cancelRes.data && cancelRes.data.success) shouldRefund = true;
                    }
                }
            } catch (err) {
                if (!smsFound) shouldRefund = true;
            }

            const finalStatus = shouldRefund ? "cancelled" : "completed";
            const { data: updated, error: updateErr } = await supabase
                .from("orders")
                .update({ status: finalStatus })
                .eq("activation_id", activationId)
                .eq("status", "active")
                .select();

            if (updateErr) {
                return setTimeout(() => pollTelegramLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
            }

            if (!updated || updated.length === 0) return;

            // ============================
            // ✅ CEK KELAYAKAN REFUND & UI
            // ============================
            if (smsFound || !shouldRefund) {
                const msgDone =
`✅ *ORDER TELEGRAM SELESAI*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}

⌛ Masa aktif habis\\. Pesanan selesai otomatis\\.`;

                await safeEditMessage(bot, chatId, messageId, msgDone, { parse_mode: "MarkdownV2" });
            } else {
                const refund = Number(order.price) || 0;
                const { error: refundError } = await supabase.rpc('increment_balance', { user_id: chatId, amount: refund });

                if (refundError) {
                    console.log("❌ REFUND ERROR:", refundError.message);
                } else {
                    console.log(`💰 [Telegram Luar] Saldo ${refund} direfund untuk ${phoneNumber}`); 
                }

                const msgExpire =
`⏰ *WAKTU TELEGRAM HABIS*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`

💰 Saldo ${esc(formatRp(refund))} dikembalikan\\.`;

                await safeEditMessage(bot, chatId, messageId, msgExpire, { parse_mode: "MarkdownV2" });
            }
            return;
        }

        // ===============================
        // 3. PROSES OTP (Hybrid: Webhook + Fallback API)
        // ===============================
        let newCode = order.sms_code;
        let smsFullText = ""; // Cadangan teks lengkap

        // 🔥 PERBAIKAN 1: Menggunakan variabel 'lastSms' sesuai parameter fungsi
        if (!newCode || newCode === lastSms) {
            try {
                const res = await axios.get(
                    "https://api.smscode.gg/v1/orders/active",
                    {
                        headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                        timeout: 10000 // Timeout cepat
                    }
                );

                if (res.data && res.data.success) {
                    const apiOrder = (res.data.data || []).find(o => String(o.id) === String(activationId));

                    // Jika API pusat bilang sudah ada OTP, tarik manual!
                    if (apiOrder && apiOrder.status === "OTP_RECEIVED" && apiOrder.otp_code) {
                        const fetchedCode = apiOrder.otp_code;

                        // Pastikan kode yang didapat adalah OTP baru (bukan OTP lama)
                        if (fetchedCode && fetchedCode !== lastSms) {
                            newCode = fetchedCode;
                            smsFullText = apiOrder.otp_message || apiOrder.sms_text || "\\-";
                            
                            // Sinkronisasi ke Supabase
                            await supabase.from("orders").update({ sms_code: newCode }).eq("activation_id", activationId);
                            console.log(`🛡️ [Fallback Telegram Luar] Berhasil jemput kode BARU dari API untuk ${phoneNumber}`);
                        }
                    }
                }
            } catch (err) {
                // Abaikan error agar loop jalan terus
            }
        }

        // ===============================
        // 🔥 UPDATE UI JIKA OTP BARU MASUK
        // ===============================
        if (newCode && newCode !== lastSms) {
            
            const cleanCode = newCode.trim();
            console.log(`✅ [Telegram Luar] OTP MASUK UNTUK ${phoneNumber} : ${cleanCode}`); 

            const { data: user } = await supabase.from("users").select("balance").eq("id", chatId).maybeSingle();

            const expiryTime = new Date(startTime + DURATION_LIMIT)
                .toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                .replace(/\./g, ":");

            // 🔥 PERBAIKAN 2: Deteksi dinamis multi-OTP
            let smsDisplay = `📩 *OTP CODE :* \`${esc(cleanCode)}\``;
            if (lastSms && lastSms !== cleanCode) {
                smsDisplay = `📩 *OTP LAMA :* \`${esc(lastSms)}\`\n📩 *OTP BARU :* \`${esc(cleanCode)}\``;
            }

            const msgUpdate =
`✅ *ORDER TELEGRAM BERHASIL*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

${smsDisplay}

📄 *SMS Text :*
\`${esc(smsFullText) || "\\-"}\`

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

            try {
                // Inline keyboard tetap dipertahankan sesuai permintaan
                await bot.telegram.editMessageText(chatId, messageId, null, msgUpdate, {
                    parse_mode: "MarkdownV2", 
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📩 Request SMS Lagi", callback_data: `resend_teleluar_${activationId}` }],
                            [{ text: "✅ Selesai", callback_data: `finish_teleluar_${activationId}` }] 
                        ]
                    }
                });

                lastSms = cleanCode;

            } catch (err) {
                if (err.message && err.message.includes('message is not modified')) {
                    lastSms = cleanCode;
                } else {
                    console.error("❌ [Telegram Luar EDIT ERROR]", err.message);
                    throw err; 
                }
            }
        }

        // ===============================
        // 4. LOOPING (Peredam Panas CPU)
        // ===============================
        // Delay sudah seragam 8 detik untuk menjaga kestabilan server & database
        const delay = lastSms ? 15000 : 8000;

        setTimeout(() => {
            pollTelegramLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend);
        }, delay);

    } catch (e) {
        console.error(`❌ [Telegram Luar] Poll Error [${phoneNumber}]:`, e.message); 
        setTimeout(() => pollTelegramLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
    }
}

// =========================================
// 🌍 HANDLER: PILIH 5 PROVIDER (TELEGRAM LUAR)
// =========================================
bot.action(/^teleluar_list_(.+)_(\d+)$/, async (ctx) => {
    // rawName = Nama Negara, apiCountryId = ID Negara dari API SMSCode
    const rawName = ctx.match[1]; 
    const apiCountryId = Number(ctx.match[2]); 
    const backButton = [{ text: "⬅️ Kembali", callback_data: "page_2_0" }]; // 🔥 FIX: Tombol kembali seragam
    
    try {
        // 🔥 Transisi smooth: Hanya popup loading, tanpa edit layar perantara
        await ctx.answerCbQuery(`🔍 Mencari stok Telegram ${rawName}...`).catch(() => {});

        // 🔥 UBAH: platform_id: 2 (KHUSUS TELEGRAM)
        const res = await axios.get("https://api.smscode.gg/v1/catalog/products", {
            params: { country_id: apiCountryId, platform_id: 2, limit: 100 },
            headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
            timeout: 10000
        });

        if (!res.data || !res.data.success) {
            return ctx.editMessageText("❌ Gagal mengambil data dari provider.", {
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        const allProducts = res.data.data || [];

        // 🔥 FIX: Filter Stok > 20 & Ambil 16 Termurah (Biar pas 8 baris Kiri-Kanan)
        const filtered = allProducts
            .filter(p => p.available >= 20)
            .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
            .slice(0, 16);

        if (filtered.length === 0) {
            return ctx.editMessageText(`❌ Maaf, saat ini tidak ada stok Telegram yang tersedia di atas 20 untuk negara *${rawName.toUpperCase()}*.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        // 🔥 KEUNTUNGAN MUTLAK 2000
        const profit = 2000;

        // ========================================================
        // 🔥 SUSUN TOMBOL JADI 2 KOLOM (KIRI & KANAN)
        // ========================================================
        const buttons = [];

        for (let i = 0; i < filtered.length; i += 2) {
            const row = [];

            // Tombol Kolom Kiri
            const itemLeft = filtered[i];
            const hargaKiri = Math.round(itemLeft.price) + profit;
            const formatKiri = `Rp. ${hargaKiri.toLocaleString('id-ID')} | Stok ${itemLeft.available}`;
            row.push(
                Markup.button.callback(
                    formatKiri, 
                    `buy_teleluar_${itemLeft.id}_${hargaKiri}_${apiCountryId}` 
                )
            );

            // Tombol Kolom Kanan (Hanya ditambahkan jika datanya ada)
            if (filtered[i + 1]) {
                const itemRight = filtered[i + 1];
                const hargaKanan = Math.round(itemRight.price) + profit;
                const formatKanan = `Rp. ${hargaKanan.toLocaleString('id-ID')} | Stok ${itemRight.available}`;
                row.push(
                    Markup.button.callback(
                        formatKanan, 
                        `buy_teleluar_${itemRight.id}_${hargaKanan}_${apiCountryId}` 
                    )
                );
            }

            buttons.push(row);
        }

        // Masukkan tombol kembali di baris paling bawah secara full-width
        buttons.push(backButton); 

        const textPesan = `✨ *PILIHAN STOK TELEGRAM: ${rawName.toUpperCase()}*\n\n` +
                          `Berikut adalah pilihan harga yang tersedia saat ini:\n\n` +
                          `_Pilih harga yang menurut Anda paling stabil:_`;

        await ctx.editMessageText(textPesan, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        }).catch(()=>{});

    } catch (e) {
        console.error("List Tele Luar Error:", e.message);
        await ctx.editMessageText("❌ Terjadi kesalahan sistem saat mengambil data dari pusat.", {
            reply_markup: { inline_keyboard: [backButton] }
        }).catch(()=>{});
    }
});

// =========================================
// 🛒 HANDLER: PROSES BELI TELEGRAM LUAR
// =========================================
bot.action(/^buy_teleluar_(\d+)_(\d+)_(\d+)$/, async (ctx) => {

    const providerId = Number(ctx.match[1]); // ID Product API
    const hargaJual = Number(ctx.match[2]);  // Harga Jual (+ Untung 2000)
    const apiCountryId = Number(ctx.match[3]);  // COUNTRY ID API

    const userId = ctx.from.id;

    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);
    let currentLoadingId = null;

    try {
        await checkUser(ctx);

        // =========================
        // 2. AMBIL NAMA NEGARA & PERCANTIK POSISI BENDERA
        // =========================
        const msgText = ctx.callbackQuery.message.text || "";
        const nameMatch = msgText.match(/PILIHAN STOK TELEGRAM:\s*(.+)/i);
        let countryName = nameMatch ? nameMatch[1].trim() : "Telegram Internasional";

        if (!isNaN(countryName) || countryName === "Telegram Internasional") {
            try {
                const countryRes = await axios.get("https://api.smscode.gg/v1/catalog/countries", {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }
                });
                if (countryRes.data && countryRes.data.success) {
                    const foundCountry = countryRes.data.data.find(c => c.id === apiCountryId);
                    if (foundCountry) countryName = `${foundCountry.emoji} ${foundCountry.name}`; 
                }
            } catch (err) {}
        }

        // 🔥 TRIK MAGIC: Pisahkan untuk UI (Struk) dan Database
        let displayCountry = countryName; 
        const flagMatch = countryName.match(/^([^\w\s]+)\s*(.+)$/i); 
        if (flagMatch) {
            // Pindahkan bendera ke kanan -> MALAYSIA 🇲🇾
            displayCountry = `${flagMatch[2]} ${flagMatch[1]}`;
        }
        
        // Simpan ke DB tetap ada kata Telegram agar history order jelas
        const finalServiceName = `Telegram ${displayCountry}`;

        // =========================
        // 3. CEK SALDO USER
        // =========================
        const { data: freshUser } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        if (!freshUser || freshUser.balance < hargaJual) {
            return ctx.answerCbQuery(`❌ Saldo tidak cukup!\nHarga: ${formatRp(hargaJual)}`, { show_alert: true }).catch(()=>{});
        }

        await ctx.deleteMessage().catch(()=>{}); 
        const loadingMsg = await ctx.reply("⏳ Memproses order Telegram...");
        currentLoadingId = loadingMsg.message_id;
        await ctx.answerCbQuery().catch(()=>{});

        // =========================
        // 4. API REQUEST (ORDER)
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/create",
                { product_id: providerId, country_id: apiCountryId, quantity: 1 },
                {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`, "Content-Type": "application/json" },
                    timeout: 8000
                }
            );
        } catch (error) {
            if (error.response && error.response.data) {
                res = error.response; 
            } else {
                return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, "❌ Gagal terhubung ke server provider.", {
                    reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `teleluar_list_${countryName}_${apiCountryId}` }]] }
                }).catch(()=>{});
            }
        }

        // =========================
        // DETEKSI STOK KOSONG
        // =========================
        const orderDetail = res.data?.data?.orders?.[0];

        if (!res.data?.success || !orderDetail) {
            const rawMsg = String(res.data?.error?.message || res.data?.message || "Terjadi kesalahan");
            const lowerMsg = rawMsg.toLowerCase();
            
            if (lowerMsg.includes("stock") || lowerMsg.includes("available") || lowerMsg.includes("quantity") || lowerMsg.includes("no numbers")) {
                return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, `⚠️ Semua provider pada harga ini sedang kosong\nSilakan pilih harga lain.`, {
                    reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali Pilih Harga", callback_data: `teleluar_list_${countryName}_${apiCountryId}` }]] }
                }).catch(()=>{});
            }

            return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, `⚠️ Gagal order: ${rawMsg}`, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `teleluar_list_${countryName}_${apiCountryId}` }]] }
            }).catch(()=>{});
        }

        // =========================
        // 5. SUCCESS & DB UPDATE
        // =========================
        const actId = String(orderDetail.id);
        const number = orderDetail.phone_number;
        const newBalance = freshUser.balance - hargaJual; 

        await Promise.all([
            supabase.from("users").update({ balance: newBalance }).eq("id", userId),
            supabase.from("orders").insert({
                user_id: userId,
                service_name: finalServiceName, // 🔥 DB tetap pakai 'Telegram MALAYSIA 🇲🇾'
                phone_number: number,
                activation_id: actId,
                price: hargaJual, 
                status: "active"
            })
        ]);

        const startTime = Date.now();
        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta", hour12: false })
            .replace(/\./g, ":");

        // 🔥 UBAH UI: Pakai "Negara :" dan displayCountry (Hanya nama negara + bendera)
        const msg =
`✅ *ORDER TELEGRAM BERHASIL*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${number}\`
💰 *Harga :* ${esc(formatRp(hargaJual))}
💵 *Saldo :* ${esc(formatRp(newBalance))}

📩 *OTP CODE :* Waiting For OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await bot.telegram.deleteMessage(ctx.chat.id, currentLoadingId).catch(()=>{});

        const sentMsg = await ctx.reply(msg, {
            parse_mode: "MarkdownV2",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "❌ Batal / Refund", callback_data: `cancel_teleluar_${actId}` }] 
                ]
            }
        });

        // 🔥 Panggil polling dengan nama DB
        pollTelegramLuar(userId, sentMsg.message_id, actId, finalServiceName, number, startTime, "");

    } catch (e) {
        console.error("Buy Tele Luar Error:", e.message);
        let countryNameFallback = "Luar Negeri";
        if (currentLoadingId) {
            await bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, "❌ Terjadi kesalahan sistem.", {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `teleluar_list_${countryNameFallback}_${apiCountryId}` }]] }
            }).catch(()=>{});
        }
    } finally {
        setTimeout(() => { activeTransactions.delete(userId); }, 1500);
    }
});

bot.action(/cancel_teleluar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK (RAM)
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. CEK ORDER & VALIDASI UI
        // =========================
        const { data: ord } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId)
            .maybeSingle();

        // 🔥 PERBAIKAN: Hapus tombol jika pesanan sudah mati
        if (!ord || ord.status !== 'active') {
            await ctx.answerCbQuery("❌ Pesanan sudah tidak aktif.", { show_alert: true }).catch(()=>{});
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 2. LIMIT 120 DETIK
        // =========================
        const startTime = new Date(ord.created_at).getTime();
        const diffSeconds = Math.floor((Date.now() - startTime) / 1000);

        if (diffSeconds < 120) {
            return ctx.answerCbQuery(
                `⚠️ Tunggu ${120 - diffSeconds} detik lagi.`,
                { show_alert: true }
            ).catch(()=>{});
        }

        // =========================
        // 3. LOCK DB
        // =========================
        const { data: locked } = await supabase
            .from('orders')
            .update({ status: 'processing_cancel' })
            .eq('activation_id', actId)
            .eq('status', 'active')
            .select();

        if (!locked || locked.length === 0) {
            await ctx.answerCbQuery("⚠️ Sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
            // 🔥 PERBAIKAN: Hapus tombol jika tabrakan klik
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 4. API PROVIDER
        // =========================
        let res;
        try {
            res = await axios.post(
                'https://api.smscode.gg/v1/orders/cancel',
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000 
                }
            );
        } catch (err) {
            res = err.response;
        }

        if (!res || !res.data) {
            // Rollback DB
            await supabase
                .from('orders')
                .update({ status: 'active' })
                .eq('activation_id', actId);

            return ctx.answerCbQuery("❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Batal.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // ✅ SUCCESS CANCEL
        // =========================
        if (res.data.success) {

            await ctx.answerCbQuery("⏳ Memproses refund...").catch(()=>{});

            const refundAmount = Number(ord.price) || 0;

            const { error: refundError } = await supabase.rpc('increment_balance', {
                user_id: userId,
                amount: refundAmount
            });

            if (refundError) {
                console.log("❌ REFUND ERROR TELE LUAR:", refundError.message);
            }

            await supabase
                .from('orders')
                .update({ status: 'cancelled' })
                .eq('activation_id', actId)
                .eq('status', 'processing_cancel'); 

            // 🔥 UBAH UI: Format teks sama persis dengan foto dan ada tombol Order Ulang
            const msgCancel =
`❌ *Order Dibatalkan*

📦 Layanan : ${esc(ord.service_name)}
📱 Nomor : \`${esc(ord.phone_number)}\`

💰 Refund : ${esc(formatRp(refundAmount))}
💳 Saldo telah dikembalikan ke akun Anda`;

            return ctx.editMessageText(msgCancel, {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Order Ulang', callback_data: 'server2' }],
                        [{ text: '🔙 Menu Utama', callback_data: 'start' }]
                    ]
                }
            }).catch(()=>{});
        }

        // =========================
        // ❌ ERROR PROVIDER API
        // =========================
        // Rollback karena gagal batal di provider
        await supabase
            .from('orders')
            .update({ status: 'active' })
            .eq('activation_id', actId);

        const apiError = res.data?.error?.code;
        const apiMessage = res.data?.message;

        // 🔥 TAMBAHAN LOG UNTUK ADMIN (Disesuaikan untuk Tele Luar)
        console.log(`[TELE LUAR REJECT] ID: ${actId} | Error: ${apiError} | Msg: ${apiMessage}`);

        if (apiError === "CANCEL_TOO_EARLY") {
            return ctx.answerCbQuery(`⚠️ ${apiMessage || "Terlalu cepat untuk batal."}`, { show_alert: true }).catch(()=>{});
        }

        return ctx.answerCbQuery(
            `⚠️ ${apiMessage || "Gagal membatalkan pesanan. Silakan coba lagi."}`,
            { show_alert: true }
        ).catch(()=>{});

    } catch (e) {
        console.error("Error Cancel Tele Luar:", e.message); 

        ctx.answerCbQuery(
            "❌ Terjadi kesalahan sistem.",
            { show_alert: true }
        ).catch(()=>{});
    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/resend_teleluar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. VALIDASI DATA
        // =========================
        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) {
            return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        }

        if (order.status !== "active") {
            return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 2. API RESEND (TIMEOUT DITAMBAH & ERROR DITANGKAP)
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/resend",
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 15000 // 🔥 Naikkan jadi 15 detik biar aman
                }
            );
        } catch (err) {
            // 🔥 Tangkap pesan error ASLI dari API pusat
            const errorMsg = err.response?.data?.message || err.response?.data?.error?.message || "Koneksi pusat sibuk/Timeout. Coba lagi.";
            console.log(`❌ Error API Resend Tele Luar [${actId}]:`, errorMsg);
            
            return ctx.answerCbQuery(`❌ Gagal: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        if (!res || !res.data || !res.data.success) {
            const errorMsg =
                res?.data?.error?.message ||
                res?.data?.message ||
                "Terjadi gangguan pada server pusat";

            return ctx.answerCbQuery(`⚠️ Gagal meminta SMS: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 3. SUCCESS - MATIKAN LOADING TOMBOL
        // =========================
        await ctx.answerCbQuery("✅ Berhasil meminta SMS baru...").catch(()=>{});

        // =========================
        // 4. HITUNG WAKTU & SALDO
        // =========================
        const startTime = new Date(order.created_at).getTime();

        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Jakarta",
                hour12: false
            })
            .replace(/\./g, ":");

        const { data: user } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        // =========================
        // 5. MESSAGE SUCCESS (MODIFIED UI)
        // =========================
        // Hapus kata Telegram agar rapi di UI
        const displayCountry = order.service_name.replace(/^Telegram\s+/i, '');
        const oldOtpCode = order.sms_code ? esc(order.sms_code) : "\\-";

        // UI dibersihkan dari "Menunggu SMS Baru" yang berantakan
        const msg =
`⏳ *MENUNGGU SMS TELEGRAM BARU*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(order.phone_number)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

📩 *OTP LAMA :* \`${oldOtpCode}\`

📩 *OTP BARU :* Waiting For New OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
        }).catch(()=>{});

        // 🔥 CRITICAL FIX: HAPUS PEMANGGILAN `pollTelegramLuar` DI SINI!
        // Polling background yang akan mengambil alih sisanya.

    } catch (e) {
        console.error("❌ RESEND TELE LUAR ERROR:", e.message);

        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{});
        } catch (err) {}

    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/finish_teleluar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        if (order.status !== "active") return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});

        let latestOtp = "";

        try {
            const apiRes = await axios.get(
                `https://api.smscode.gg/v1/orders/${actId}`,
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, timeout: 8000 }
            );

            if (apiRes.data.success) {
                latestOtp = apiRes.data.data?.otp_code || "";
            }
        } catch (err) {}

        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/finish",
                { id: parseInt(actId) },
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`, "Content-Type": "application/json" }, timeout: 8000 }
            );
        } catch (err) {
            return ctx.answerCbQuery("❌ Koneksi sibuk. Silakan KLIK ULANG tombol Selesai.", { show_alert: true }).catch(()=>{});
        }

        const result = res?.data;

        if (!result?.success && result?.data?.status !== "COMPLETED") {
            const errMsg = result?.error?.message || result?.message || "Status pesanan tidak valid";
            return ctx.answerCbQuery(`⚠️ Gagal menyelesaikan order: ${errMsg}`, { show_alert: true }).catch(()=>{});
        }

        await ctx.answerCbQuery("✅ Order Telegram Selesai!").catch(()=>{});

        if (latestOtp) {
            await supabase.from("orders").update({ sms_code: latestOtp }).eq("activation_id", actId);
        }

        await supabase.from("orders").update({ status: "completed" }).eq("activation_id", actId).eq("status", "active");

        // 🔥 UBAH UI: Format Sesuai Foto (Tanpa Tombol)
        // Karena di handler buy_teleluar service_name sudah kita set "Telegram [Negara]",
        // Maka kita cukup panggil ${esc(order.service_name)} saja agar rapi.
        const msg =
`✅ *ORDER SELESAI*

📦 Layanan: ${esc(order.service_name)}
📱 Nomor : \`${esc(order.phone_number)}\`
💰 Harga : Rp ${esc(order.price.toLocaleString('id-ID'))}

🙏 Terima kasih telah menggunakan layanan kami\\!`;

        return ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
        }).catch(()=>{});

    } catch (e) {
        console.error("❌ ERROR FINISH TELE LUAR:", e.message); 
        try { await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{}); } catch(err){}
    } finally {
        activeTransactions.delete(userId);
    }
});

async function generateListVak(ctx, page = 0) {
    try {
        const { data: services, error } = await supabase
            .from('services_vak')
            .select('*')
            .order('id', { ascending: true });

        if (error || !services) return ctx.reply("❌ Gagal mengambil data.");

        const total = services.length;
        const perPage = 10;
        const totalPage = Math.max(1, Math.ceil(total / perPage));

        // 🔥 CLAMP PAGE
        if (isNaN(page) || page < 0) page = 0;
        if (page >= totalPage) page = totalPage - 1;

        const start = page * perPage;
        const end = start + perPage;
        const pageData = services.slice(start, end);
        const currentPage = page + 1;

        let text = `⚙️ *DASHBOARD ADMIN: LIST VAK*\n`;
        text += `📄 *Halaman ${currentPage}/${totalPage}* ${esc(`(Total: ${total})`)}\n`;
        text += esc(`──────────────────`) + `\n\n`; // FIX: Escape garis pemisah

        pageData.forEach((s) => {
            text += `🆔 *ID ${s.id}* — ${esc(s.name)}\n`;
            text += `💰 ${esc(formatRp(s.price))} 📟 *Kode:* \`${esc(s.code || "-")}\`\n`;
            // FIX: Pastikan s.server tidak null sebelum toString
            const srvMsg = s.server !== null && s.server !== undefined ? s.server.toString() : "-";
            text += `🌐 *Negara:* \`${esc(s.country || "-")}\` 🖥 *Srv:* \`${esc(srvMsg)}\`\n\n`;
        });

        const buttons = [];
        const navRow = [];

        if (page > 0) {
            navRow.push(Markup.button.callback("⬅️ Prev", `vakpadm_${page - 1}`));
        }

        navRow.push(Markup.button.callback(`${currentPage}/${totalPage}`, "ignore"));

        if (page < totalPage - 1) {
            navRow.push(Markup.button.callback("Next ➡️", `vakpadm_${page + 1}`));
        }

        if (navRow.length > 0) buttons.push(navRow);

        const extra = {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
        };

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, extra).catch((e) => console.error("Edit Error ListVak:", e.message));
        } else {
            await ctx.reply(text, extra).catch((e) => console.error("Reply Error ListVak:", e.message));
        }

    } catch (e) {
        console.error("Global Error ListVak:", e);
    }
}

// --- HANDLER CALLBACK ---
bot.action(/vakpadm_(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await ctx.answerCbQuery().catch(() => {});
    return generateListVak(ctx, page);
});

// --- COMMAND ---
bot.command('listvak', async (ctx) => {
    // Sesuaikan ADMIN_ID dengan env kamu
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    return generateListVak(ctx, 0);
});

bot.command('delvak', async (ctx) => {
    // 1. Keamanan: Cek apakah yang kirim perintah adalah Admin
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // 2. Ambil ID dari pesan (Contoh: /delvak 5)
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply("⚠️ Format salah! Gunakan: `/delvak <id>`\nContoh: `/delvak 1`", { parse_mode: 'Markdown' });
    }

    const vakId = args[1];

    try {
        // 3. Cek apakah layanan memang ada di database
        const { data: check, error: checkError } = await supabase
            .from('services_vak')
            .select('name')
            .eq('id', vakId)
            .maybeSingle();

        if (!check) {
            return ctx.reply(`❌ Layanan dengan ID \`${vakId}\` tidak ditemukan.`, { parse_mode: 'MarkdownV2' });
        }

        // 4. Proses Penghapusan
        const { error: delError } = await supabase
            .from('services_vak')
            .delete()
            .eq('id', vakId);

        if (delError) throw delError;

        // 5. Berhasil: Kirim konfirmasi
        await ctx.reply(`✅ *BERHASIL DIHAPUS*\n\n🗑 Layanan: *${esc(check.name)}*\n🆔 ID: \`${vakId}\` telah dihapus dari tabel VAK\\.`, { 
            parse_mode: 'MarkdownV2' 
        });

        // 6. Reset Cache (Penting!)
        // Agar layanan yang dihapus langsung hilang dari menu user tanpa menunggu CACHE_DURATION
        if (typeof cacheServices !== 'undefined') {
            cacheServices = {1: [], 2: []};
            console.log("♻️ Cache services direset karena ada penghapusan layanan VAK.");
        }

    } catch (e) {
        console.error("Error DelVak:", e.message);
        ctx.reply("❌ Gagal menghapus layanan. Cek log konsol.");
    }
});

bot.command('editharga_vak', async (ctx) => {
    // 1. Keamanan: Cek Admin
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // 2. Ambil Argumen (Contoh: /editharga_vak 1 1500)
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply("⚠️ *Format Salah!*\n\nGunakan: `/editharga_vak <id> <harga>`\nContoh: `/editharga_vak 1 850`", { parse_mode: 'Markdown' });
    }

    const vakId = args[1];
    const newPrice = parseInt(args[2]);

    if (isNaN(newPrice)) {
        return ctx.reply("❌ Harga harus berupa angka!");
    }

    try {
        // 3. Cek keberadaan layanan
        const { data: check, error: checkError } = await supabase
            .from('services_vak')
            .select('name, price')
            .eq('id', vakId)
            .maybeSingle();

        if (!check) {
            return ctx.reply(`❌ Layanan ID \`${vakId}\` tidak ditemukan.`);
        }

        // 4. Update Harga di Supabase
        const { error: updateError } = await supabase
            .from('services_vak')
            .update({ price: newPrice })
            .eq('id', vakId);

        if (updateError) throw updateError;

        // 5. Berhasil: Kirim Konfirmasi
        const text = `✅ *HARGA VAK DIPERBARUI*\n\n` +
                     `📦 Layanan : *${esc(check.name)}*\n` +
                     `🆔 ID      : \`${vakId}\`\n` +
                     `💰 Lama    : ${esc(formatRp(check.price))}\n` +
                     `💵 Baru    : *${esc(formatRp(newPrice))}*`;

        await ctx.reply(text, { parse_mode: 'MarkdownV2' });

        // 6. Reset Cache Services
        if (typeof cacheServices !== 'undefined') {
            cacheServices = {1: [], 2: []};
            console.log(`♻️ Cache direset: Harga ${check.name} berubah ke ${newPrice}`);
        }

    } catch (e) {
        console.error("Error EditHargaVak:", e.message);
        ctx.reply("❌ Terjadi kesalahan saat update harga.");
    }
});

// --- 5. LOGIKA STATUS API ---
bot.action(/check_(.+)/, async (ctx) => {

    await ctx.answerCbQuery("Cek otomatis sedang berjalan...", { show_alert: true })
        .catch(() => {});

    const actId = ctx.match[1];

    // (opsional) bisa tambahkan logic check manual kalau mau
});

bot.action(/st1_(.+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // ?? ANTI SPAM KLIK BERKALI-KALI
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sabar, sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // 🔥 FIX: Hentikan putaran loading tombol secepatnya
        await ctx.answerCbQuery("⏳ Request SMS baru dikirim...").catch(()=>{});

        const { data: ord } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId)
            .maybeSingle();

        // ===============================
        // VALIDASI 
        // ===============================
        if (!ord || ord.status !== 'active') {
            // Karena answerCbQuery sudah dipanggil di atas, 
            // kita tidak bisa pakai show_alert: true lagi di sini.
            // Gunakan editMessageText untuk memberi tahu error.
            return ctx.editMessageText("❌ Order tidak valid atau sudah tidak aktif.").catch(()=>{});
        }

        // ===============================
        // HIT API
        // ===============================
        const res = await axios.get(
            `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=1&id=${actId}`,
            { timeout: 8000 }
        );

        // ===============================
        // UPDATE UI / PESAN
        // ===============================
        // Karena SMSBower hanya mengubah status di belakang layar, 
        // kamu bisa memilih untuk mengedit pesan jika perlu, 
        // atau membiarkan poll berjalan seperti biasa.
        // Contoh jika ingin kasih feedback visual:
        // await ctx.editMessageText("... pesan update ...").catch(()=>{});
        
    } catch (e) {
        console.error('[SET STATUS ERROR]', e.message);

        // Karena answerCbQuery sudah dipanggil di awal, gunakan edit pesan untuk info error
        try {
            await ctx.editMessageText("❌ Gagal terhubung ke server provider.").catch(()=>{});
        } catch(err){}
        
    } finally {
        activeTransactions.delete(userId);
    }
});

// --- FIX: BUTTON SELESAI (ST6) ---
bot.action(/st6_(.+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // ===============================
        // 1. AMBIL ORDER & VALIDASI
        // ===============================
        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId) // 🔥 WAJIB
            .maybeSingle();

        if (!order || order.status !== 'active') {
            return ctx.answerCbQuery(
                "❌ Order tidak valid / sudah tidak aktif.",
                { show_alert: true }
            ).catch(()=>{});
        }

        // ❌ JANGAN EDIT PESAN & JANGAN JAWAB CALLBACK DI SINI!
        // Biarkan tombol Telegram loading (spinner) berputar otomatis.

        // ===============================
        // 2. API SET STATUS (TIMEOUT 8 DETIK)
        // ===============================
        let res;
        try {
            res = await axios.get(
                `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=6&id=${actId}`,
                { timeout: 8000 }
            );
        } catch {
            // 🔥 POPUP ERROR KONEKSI (Layar utama & tombol tetap aman)
            return ctx.answerCbQuery(
                "❌ Koneksi sibuk. Silakan KLIK ULANG tombol Selesai.", 
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 3. SUCCESS NORMAL ATAU FALLBACK
        // ===============================
        if (res.data === 'ACCESS_ACTIVATION' || (res.data === 'BAD_STATUS' && order.sms_code)) {

            // 🔥 Matikan loading di tombol karena proses fix sukses
            await ctx.answerCbQuery("✅ Order Selesai!").catch(()=>{});

            const { data: updated } = await supabase
                .from('orders')
                .update({ status: 'completed' })
                .eq('activation_id', actId)
                .eq('status', 'active')
                .select();

            if (!updated || updated.length === 0) {
                // Gunakan popup agar UI tidak rusak kalau ternyata nyangkut di DB
                return ctx.answerCbQuery("⚠️ Order sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
            }

            // Sync teks jika masuk jalur fallback
            const isSync = res.data === 'BAD_STATUS' ? " \\(Sync\\)" : "";

            const msg =
`✅ *ORDER SELESAI*${isSync}

📦 *Layanan:* ${esc(order.service_name)}
📱 *Nomor  :* \`${esc(order.phone_number)}\`
💰 *Harga  :* ${esc(formatRp(order.price))}

🙏 Terima kasih telah menggunakan layanan kami\\!`;

            await ctx.editMessageText(msg, {
                parse_mode: 'MarkdownV2'
            }).catch(()=>{});

        } 
        // ===============================
        // 4. ERROR API DITOLAK
        // ===============================
        else {
            // 🔥 Gunakan popup agar layar tidak rusak
            return ctx.answerCbQuery(`⚠️ Gagal menyelesaikan: ${res.data}`, { show_alert: true }).catch(()=>{});
        }

    } catch (e) {
        console.error("ST6 Error:", e.message);

        // 🔥 Popup untuk error fatal
        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{});
        } catch(err){}
    } finally {
        // 🔓 UNLOCK
        activeTransactions.delete(userId);
    }
});

// --- ANOTHER SMS (MENGGANTIKAN ST3 RESEND) ---
bot.action(/another_sms_(.+)/, async (ctx) => {

    const actIdRaw = ctx.match[1];
    const userId = ctx.from.id;

    const actId = parseInt(actIdRaw);
    if (isNaN(actId)) {
        return ctx.answerCbQuery(
            "❌ Data tidak valid.",
            { show_alert: true }
        ).catch(()=>{});
    }

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        // 🔥 CHECK USER 
        await checkUser(ctx);

        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId) // 🔥 WAJIB
            .maybeSingle();

        // ===============================
        // 1. VALIDASI
        // ===============================
        if (!order) {
            return ctx.answerCbQuery(
                "❌ Order tidak ditemukan.",
                { show_alert: true }
            ).catch(()=>{});
        }

        if (order.status !== 'active') {
            return ctx.answerCbQuery(
                "❌ Order sudah tidak aktif.",
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 2. REQUEST SMS KE PROVIDER
        // ===============================
        try {
            await axios.get(
                `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=3&id=${actId}`,
                { timeout: 15000 } // 🔥 Naikkan ke 15 detik biar nggak gampang ngeluarin error palsu
            );
        } catch (err) {
            return ctx.answerCbQuery(
                "❌ Koneksi pusat sibuk. Silakan KLIK ULANG tombol Request SMS.", 
                { show_alert: true }
            ).catch(()=>{});
        }

        // ===============================
        // 3. SUCCESS - MATIKAN LOADING TOMBOL
        // ===============================
        await ctx.answerCbQuery("✅ Berhasil meminta SMS baru...").catch(()=>{});

        // ===============================
        // 4. HITUNG WAKTU & AMBIL SALDO
        // ===============================
        const startTime = new Date(order.created_at).getTime();

        const expiryTime = new Date(startTime + 1500000)
            .toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'Asia/Jakarta',
                hour12: false
            }).replace(/\./g, ':');

        const { data: user } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .maybeSingle();

        // ===============================
        // 5. MESSAGE SUCCESS (MODIFIED UI DENGAN TOMBOL SELESAI)
        // ===============================
        const oldOtpCode = order.sms_code ? esc(order.sms_code) : "\\-";

        // Tampilan dirapikan dan disamakan dengan format server lain
        const msg =
`⏳ *MENUNGGU SMS BARU*

📦 *Layanan :* ${esc(order.service_name)}
📱 *Nomor :* \`${esc(order.phone_number)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

📩 *OTP LAMA :* \`${oldOtpCode}\`

📩 *OTP BARU :* Waiting For New OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        // 🔥 FITUR KHUSUS SERVER 1: 
        // Munculkan kembali tombol 'Selesai' jika kode OTP sudah pernah masuk,
        // sehingga user bisa langsung klik selesai tanpa menunggu OTP baru.
        const keyboard = order.sms_code ? {
            inline_keyboard: [
                [{ text: '✅ Selesai', callback_data: `st6_${actId}` }]
            ]
        } : undefined;

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard
        }).catch(()=>{});

        // 🔥 CRITICAL FIX: HAPUS PEMANGGILAN `pollSMS` DI SINI!
        // Polling yang di-trigger saat order pertama masih berjalan.
        // Dialah yang akan bertugas menangkap OTP baru, jadi kita gak perlu panggil lagi.

    } catch (e) {
        console.error("❌ [another_sms ERROR]:", e.message);

        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Coba lagi.", { show_alert: true }).catch(()=>{});
        } catch(err){}
    } finally {
        // 🔓 UNLOCK
        activeTransactions.delete(userId);
    }
});

bot.action(/st8_(.+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // ===============================
        // 1. CEK ORDER & VALIDASI UI
        // ===============================
        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId)
            .maybeSingle();

        // 🔥 PERBAIKAN: Hapus tombol jika pesanan sudah mati
        if (!order || order.status !== 'active') {
            await ctx.answerCbQuery("❌ Pesanan sudah tidak aktif.", { show_alert: true }).catch(()=>{});
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // ===============================
        // 2. CEK OTP DB
        // ===============================
        if (order.sms_code) {
            await ctx.answerCbQuery("❌ OTP sudah diterima, tidak bisa dibatalkan.", { show_alert: true }).catch(()=>{});
            // Hapus tombol Batal juga karena sudah dilarang batal
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // ===============================
        // 3. CEK STATUS PROVIDER
        // ===============================
        let check;
        try {
            check = await axios.get(
                `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getStatus&id=${actId}`,
                { timeout: 4000 } 
            );
        } catch {
            return ctx.answerCbQuery("❌ Koneksi sibuk. Silakan KLIK ULANG tombol Batal.", { show_alert: true }).catch(()=>{});
        }

        const status = check.data;

        if (typeof status === 'string' && status.includes('STATUS_OK')) {
            await ctx.answerCbQuery("❌ OTP sudah masuk, tidak bisa dibatalkan.", { show_alert: true }).catch(()=>{});
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // 🔥 Deteksi jika pusat sudah membatalkan duluan
        let isAlreadyCanceledAtProvider = false;
        if (typeof status === 'string' && status.includes('STATUS_CANCEL')) {
            isAlreadyCanceledAtProvider = true;
        }

        // ===============================
        // 4. CANCEL PROVIDER (Hanya jika belum batal di pusat)
        // ===============================
        let resData = "";
        
        if (!isAlreadyCanceledAtProvider) {
            try {
                const res = await axios.get(
                    `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=setStatus&status=8&id=${actId}`,
                    { timeout: 8000 } 
                );
                resData = res.data;
            } catch {
                return ctx.answerCbQuery("❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Batal.", { show_alert: true }).catch(()=>{});
            }

            if (resData === 'EARLY_CANCEL_DENIED') {
                return ctx.answerCbQuery("⚠️ Tunggu 2 menit sebelum membatalkan.", { show_alert: true }).catch(()=>{});
            }
        }

        // ===============================
        // 5. SUCCESS CANCEL & REFUND
        // ===============================
        // 🔥 Lanjut eksekusi refund JIKA: Pusat sudah batal duluan ATAU Eksekusi batal barusan sukses
        if (isAlreadyCanceledAtProvider || resData === 'ACCESS_CANCEL_TRUE' || resData === 'ACCESS_CANCEL') {
            
            await ctx.answerCbQuery("⏳ Memproses pengembalian dana...").catch(()=>{});

            // Lock & Update DB
            const { data: updated } = await supabase
                .from('orders')
                .update({ status: 'cancelled' })
                .eq('activation_id', actId)
                .eq('status', 'active')
                .select()
                .maybeSingle();

            // Jika gagal update DB (tabrakan klik)
            if (!updated) {
                await ctx.answerCbQuery("⚠️ Pesanan sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
                return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
            }

            const refundAmount = Number(order.price) || 0;

            const { error: refundError } = await supabase.rpc('increment_balance', {
                user_id: userId,
                amount: refundAmount
            });

            if (refundError) {
                console.error("REFUND ERROR:", refundError.message);
                return ctx.answerCbQuery("❌ Gagal refund saldo. Silakan hubungi admin.", { show_alert: true }).catch(()=>{});
            }

            const isAutoBatal = isAlreadyCanceledAtProvider ? " \\(Otomatis dari Pusat\\)" : "";

            // 🔥 UBAH UI: Tambahkan Tombol Order Ulang dan Menu Utama
            await ctx.editMessageText(
`❌ *Order Dibatalkan*${isAutoBatal}

📦 *Layanan :* ${esc(order.service_name)}
📱 *Nomor :* \`${esc(order.phone_number)}\`

💰 *Refund :* ${esc(formatRp(refundAmount))}
💳 *Saldo telah dikembalikan ke akun Anda*`,
                { 
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Order Ulang', callback_data: 'server1' }],
                            [{ text: '🔙 Menu Utama', callback_data: 'start' }]
                        ]
                    }
                }
            ).catch(()=>{});

        } else {
            return ctx.answerCbQuery(`⚠️ Gagal batal: ${resData}`, { show_alert: true }).catch(()=>{});
        }

    } catch (err) {
        console.error("Cancel Error:", err.message);
        ctx.answerCbQuery("❌ Terjadi kesalahan sistem saat membatalkan.", { show_alert: true }).catch(()=>{});
        
    } finally {
        // 🔓 UNLOCK
        activeTransactions.delete(userId);
    }
});

//// ORDER SMS CODE ////
async function pollSmscode(
    chatId,
    messageId,
    activationId,
    serviceName,
    phoneNumber,
    startTime,
    lastSms = "",
    isResend = false
) {
    const DURATION_LIMIT = 20 * 60 * 1000; // 20 Menit

    try {
        const { data: order, error: dbError } = await supabase
            .from("orders")
            .select("status, sms_code, price") // 🔥 Murni hanya baca kolom yang ada (Super Ringan)
            .eq("activation_id", activationId)
            .maybeSingle();

        // 🔥 PERBAIKAN 1: Jangan biarkan polling mati kalau cuma error koneksi DB sesaat!
        if (dbError) {
            console.log(`[DEBUG-ERROR] Supabase Error:`, dbError.message);
            return setTimeout(() => pollSmscode(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
        }
        
        // Baru hentikan polling jika memang order sudah tidak ada atau tidak aktif
        if (!order || order.status !== "active") return;

        const now = Date.now();
        const timeElapsed = now - startTime;

        // ============================
        // ⏰ EXPIRED & ANTI-RUGI
        // ============================
        if (timeElapsed >= DURATION_LIMIT) {
            console.log(`⏰ [SMSCode] Waktu habis untuk nomor: ${phoneNumber}`);
            let shouldRefund = false;
            let smsFound = order.sms_code || lastSms;

            try {
                const checkRes = await axios.get(
                    `https://api.smscode.gg/v1/orders/${activationId}`,
                    { 
                        headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                        timeout: 20000 
                    }
                );

                if (checkRes.data && checkRes.data.success) {
                    const apiStatus = checkRes.data.data.status;
                    if (apiStatus === "EXPIRED" || apiStatus === "CANCELLED" || apiStatus === "TIMEOUT") {
                        shouldRefund = true;
                    } else if (apiStatus === "COMPLETED" || apiStatus === "OTP_RECEIVED" || checkRes.data.data.otp_code) {
                        shouldRefund = false;
                        smsFound = true;
                    } else {
                        const cancelRes = await axios.post(
                            "https://api.smscode.gg/v1/orders/cancel",
                            { id: parseInt(activationId) },
                            { 
                                headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, 
                                timeout: 20000 
                            }
                        );
                        if (cancelRes.data && cancelRes.data.success) shouldRefund = true;
                    }
                }
            } catch (err) {
                if (!smsFound) shouldRefund = true;
            }

            // Langsung set status final yang benar
            const finalStatus = shouldRefund ? "cancelled" : "completed";
            const { data: updated, error: updateErr } = await supabase
                .from("orders")
                .update({ status: finalStatus })
                .eq("activation_id", activationId)
                .eq("status", "active")
                .select();

            if (updateErr) {
                return setTimeout(() => pollSmscode(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
            }

            if (!updated || updated.length === 0) return;

            // ============================
            // ✅ UI UPDATE & REFUND 
            // ============================
            if (smsFound || !shouldRefund) {
                const msgDone =
`✅ *ORDER SELESAI*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}

⌛ Masa aktif habis\\.
Pesanan selesai otomatis\\.`;
                await safeEditMessage(bot, chatId, messageId, msgDone, { parse_mode: "MarkdownV2" });
            } else {
                const refund = Number(order.price) || 0;
                const { error: refundError } = await supabase.rpc('increment_balance', { user_id: chatId, amount: refund });
                if (refundError) {
                    console.log("❌ REFUND ERROR:", refundError.message);
                } else {
                    console.log(`💰 [SMSCode] Saldo ${refund} direfund untuk ${phoneNumber}`);
                }

                const msgExpire =
`⏰ *WAKTU HABIS*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`

💰 Saldo ${esc(formatRp(refund))} dikembalikan\\.`;
                await safeEditMessage(bot, chatId, messageId, msgExpire, { parse_mode: "MarkdownV2" });
            }
            return; // Selesai
        }

        // ===============================
        // 3. PROSES OTP (Hybrid: Webhook + Fallback API)
        // ===============================
        let newCode = order.sms_code;
        let smsFullText = ""; // Siapkan wadah untuk teks lengkap

        // 🔥 PERBAIKAN 2: Gunakan 'lastSms' (bukan previousCode) sebagai penanda OTP lama di parameter fungsi
        if (!newCode || newCode === lastSms) {
            try {
                const res = await axios.get(
                    "https://api.smscode.gg/v1/orders/active",
                    { 
                        headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, 
                        timeout: 10000 // Timeout cepat agar tidak menggantung lama
                    }
                );

                if (res.data && res.data.success) {
                    const apiOrder = (res.data.data || []).find(o => String(o.id) === String(activationId));

                    // Jika API pusat bilang sudah ada OTP, tarik manual!
                    if (apiOrder && apiOrder.status === "OTP_RECEIVED" && apiOrder.otp_code) {
                        const fetchedCode = apiOrder.otp_code;

                        // Pastikan kode yang didapat adalah OTP baru (bukan OTP lama)
                        if (fetchedCode && fetchedCode !== lastSms) {
                            newCode = fetchedCode;
                            smsFullText = apiOrder.otp_message || apiOrder.sms_text || "\\-";
                            
                            // Sinkronisasi ke Supabase
                            await supabase.from("orders").update({ sms_code: newCode }).eq("activation_id", activationId);
                            console.log(`🛡️ [Fallback SMSCode] Berhasil jemput kode BARU dari API untuk ${phoneNumber}`);
                        }
                    }
                }
            } catch (err) {
                // Abaikan error (timeout/dsb), lanjut putaran berikutnya
            }
        }

        // ===============================
        // 🔥 UPDATE UI JIKA OTP BARU MASUK
        // ===============================
        if (newCode && newCode !== lastSms) {
            
            const cleanCode = newCode.trim();
            console.log(`✅ [SMSCode] OTP MASUK UNTUK ${phoneNumber} : ${cleanCode}`); 

            const { data: user } = await supabase
                .from("users")
                .select("balance")
                .eq("id", chatId)
                .maybeSingle();

            const expiryTime = new Date(startTime + DURATION_LIMIT)
                .toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                .replace(/\./g, ":");

            // 🔥 PERBAIKAN 3: Deteksi dinamis multi-OTP untuk tampilan antarmuka Telegram
            let smsDisplay = `📩 *OTP CODE :* \`${esc(cleanCode)}\``;
            if (lastSms && lastSms !== cleanCode) {
                smsDisplay = `📩 *OTP LAMA :* \`${esc(lastSms)}\`\n📩 *OTP BARU :* \`${esc(cleanCode)}\``;
            }

            const msgUpdate =
`✅ *ORDER BERHASIL*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

${smsDisplay}

📄 *SMS Text :*
\`${esc(smsFullText) || "\\-"}\`

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

            try {
                await bot.telegram.editMessageText(chatId, messageId, null, msgUpdate, {
                    parse_mode: "MarkdownV2",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📩 Request SMS Lagi", callback_data: `resend_smscode_${activationId}` }],
                            [{ text: "✅ Selesai", callback_data: `finish_smscode_${activationId}` }]
                        ]
                    }
                });

                // Perbarui memori bot
                lastSms = cleanCode;
            } catch (err) {
                // Obat Anti-Amnesia jika pesan sama
                if (err.message && err.message.includes('message is not modified')) {
                    lastSms = cleanCode;
                } else {
                    console.error("❌ [SMSCode EDIT ERROR]", err.message);
                    throw err; 
                }
            }
        }

        // ===============================
        // 4. LOOPING (Peredam Panas CPU)
        // ===============================
        // Delay pintar dan aman: 15 detik jika sudah ada SMS, 8 detik jika belum ada
        const delay = lastSms ? 15000 : 8000;

        setTimeout(() => {
            pollSmscode(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend);
        }, delay);

    } catch (e) {
        console.error(`❌ [SMSCode] Poll Error [${phoneNumber}]:`, e.message);
        setTimeout(() => pollSmscode(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
    }
}

// =========================================
// 🔍 HANDLER 1: PILIH 5 PROVIDER (SERVER 3)
// =========================================
bot.action(/^smscode_list_(.+)_(\d+)$/, async (ctx) => {
    const rawName = ctx.match[1]; // Menangkap nama layanan
    const localDbId = Number(ctx.match[2]);
    const keyword = rawName.toLowerCase();
    
    // 🔥 Tombol kembali seragam
    const backButton = [{ text: "⬅️ Kembali", callback_data: "server3" }];
    
    try {
        await ctx.answerCbQuery(`🔍 Mencari stok terbaik...`).catch(() => {});

        // 1. Tarik data fresh dari API SMSCode
        const res = await axios.get("https://api.smscode.gg/v1/catalog/products", {
            params: { country_id: 7, limit: 5000 },
            headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
            timeout: 10000
        });

        if (!res.data.success) {
            return ctx.editMessageText("❌ Gagal mengambil data dari provider.", {
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        const allProducts = res.data.data || [];

        // 2. Filter, Anti-Tabrakan Google, & Syarat Stok > 20
        const filtered = allProducts.filter(p => {
            if (p.available < 20) return false; // Abaikan jika stok di bawah 20

            const apiName = p.name.toLowerCase().replace(/\s/g, '');
            
            if (localDbId === 7 || keyword.includes('google')) {
                return apiName.includes('google/youtube/gmail');
            } else if (localDbId === 47 || keyword.includes('anyother')) {
                return apiName.includes('anyother');
            } else {
                return apiName.includes(keyword);
            }
        })
        .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
        .slice(0, 16); // 🔥 FIX: Ambil 16 teratas untuk 8 baris (Kiri & Kanan)

        if (filtered.length === 0) {
            return ctx.editMessageText(`❌ Maaf, saat ini tidak ada provider yang memiliki stok lebih dari 20 untuk layanan *${rawName.toUpperCase()}*.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        // 3. Tentukan Keuntungan (WA/Tele 1000, lainnya 600)
        let profit = 600;
        if (localDbId === 1 || localDbId === 2) {
            profit = 1000;
        }

        // ========================================================
        // 4. 🔥 SUSUN TOMBOL JADI 2 KOLOM (KIRI & KANAN)
        // ========================================================
        const buttons = [];

        for (let i = 0; i < filtered.length; i += 2) {
            const row = [];

            // Tombol Kolom Kiri
            const itemLeft = filtered[i];
            const hargaKiri = Math.round(itemLeft.price) + profit;
            const formatKiri = `Rp. ${hargaKiri.toLocaleString('id-ID')} | Stok ${itemLeft.available}`;
            row.push(
                Markup.button.callback(
                    formatKiri, 
                    `buy_smscode_${itemLeft.id}_${hargaKiri}_${localDbId}` 
                )
            );

            // Tombol Kolom Kanan (Jika ada)
            if (filtered[i + 1]) {
                const itemRight = filtered[i + 1];
                const hargaKanan = Math.round(itemRight.price) + profit;
                const formatKanan = `Rp. ${hargaKanan.toLocaleString('id-ID')} | Stok ${itemRight.available}`;
                row.push(
                    Markup.button.callback(
                        formatKanan, 
                        `buy_smscode_${itemRight.id}_${hargaKanan}_${localDbId}` 
                    )
                );
            }

            buttons.push(row);
        }

        // Masukkan tombol kembali di baris paling bawah secara full-width
        buttons.push(backButton);

        const textPesan = `✨ *LAYANAN TERPILIH: ${rawName.toUpperCase()}*\n\n` +
                          `Berikut adalah pilihan harga yang tersedia saat ini:\n\n` +
                          `_Pilih harga yang menurut Anda paling stabil:_`;

        await ctx.editMessageText(textPesan, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        }).catch(()=>{});

    } catch (e) {
        console.error("List Provider Error:", e.message);
        await ctx.editMessageText("❌ Terjadi kesalahan saat memproses data.", {
            reply_markup: { inline_keyboard: [backButton] }
        }).catch(()=>{});
    }
});

// =========================================
// 🛒 HANDLER 2: PROSES BELI SMSCODE
// =========================================
bot.action(/^buy_smscode_(\d+)_(\d+)_(\d+)$/, async (ctx) => {

    const providerId = Number(ctx.match[1]); // Menangkap ID Provider API
    const hargaJual = Number(ctx.match[2]);  // Menangkap Harga yang dipilih user
    const serviceId = Number(ctx.match[3]);  // Menangkap ID lokal/API
    
    const userId = ctx.from.id;

    // 🔒 1. ANTI SPAM & DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery(
            "⏳ Sedang diproses...",
            { show_alert: true }
        ).catch(()=>{});
    }

    activeTransactions.add(userId);
    let currentLoadingId = null;

    try {
        await checkUser(ctx);

        // =========================
        // 2. CEK DATA & SALDO
        // =========================
        
        // 🔥 PERBAIKAN: Ambil nama layanan dari teks menu "Layanan Terpilih"
        const msgText = ctx.callbackQuery.message.text || "";
        const nameMatch = msgText.match(/LAYANAN TERPILIH:\s*(.+)/i);
        // Jika ketemu, pakai namanya. Jika tidak, pakai ID-nya sebagai fallback
        const serviceName = nameMatch ? nameMatch[1].trim() : `Server 3 (${serviceId})`;
        const safeName = serviceName.replace(/\s/g, '').substring(0, 20); // Mencegah error kepanjangan

        const { data: freshUser } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        if (!freshUser || freshUser.balance < hargaJual) {
            return ctx.answerCbQuery(
                `❌ Saldo tidak cukup!\nHarga: ${formatRp(hargaJual)}`,
                { show_alert: true }
            ).catch(()=>{});
        }

        // =========================
        // 3. LOGIKA ANTI-TIMPA
        // =========================
        await ctx.deleteMessage().catch(()=>{}); 

        const loadingMsg = await ctx.reply("⏳ Memproses order...");
        currentLoadingId = loadingMsg.message_id;

        await ctx.answerCbQuery().catch(()=>{});

        // =========================
        // 4. API REQUEST
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/create",
                {
                    product_id: providerId, 
                    quantity: 1
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000
                }
            );
        } catch (error) {
            if (error.response && error.response.data) {
                res = error.response; 
            } else {
                return bot.telegram.editMessageText(
                    ctx.chat.id,
                    currentLoadingId,
                    null,
                    "❌ Gagal terhubung ke server provider.",
                    {
                        // 🔥 FIX: Kembali presisi ke menu harga layanannya
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `smscode_list_${safeName}_${serviceId}` }]]
                        }
                    }
                ).catch(()=>{});
            }
        }

        // =========================
        // DETEKSI STOK KOSONG / ERROR LAIN (🔥 UPDATE UI)
        // =========================
        const orderDetail = res.data?.data?.orders?.[0];

        if (!res.data?.success || !orderDetail) {
            const rawMsg = String(res.data?.error?.message || res.data?.message || "Terjadi kesalahan");
            const lowerMsg = rawMsg.toLowerCase();
            
            // 🔥 UBAH UI: Format Stok Kosong Sesuai Server Tele Luar & WA Luar
            if (lowerMsg.includes("stock") || lowerMsg.includes("available") || lowerMsg.includes("quantity") || lowerMsg.includes("no numbers")) {
                return bot.telegram.editMessageText(
                    ctx.chat.id,
                    currentLoadingId,
                    null,
                    `⚠️ Semua provider pada harga ini sedang kosong\nSilakan pilih harga lain.`,
                    {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🔙 Kembali Pilih Harga", callback_data: `smscode_list_${safeName}_${serviceId}` }]]
                        }
                    }
                ).catch(()=>{});
            }

            return bot.telegram.editMessageText(
                ctx.chat.id,
                currentLoadingId,
                null,
                `⚠️ Gagal order: ${rawMsg}`,
                {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `smscode_list_${safeName}_${serviceId}` }]]
                    }
                }
            ).catch(()=>{});
        }

        // =========================
        // 5. SUCCESS & DB UPDATE
        // =========================
        const actId = String(orderDetail.id);
        const number = orderDetail.phone_number;
        const newBalance = freshUser.balance - hargaJual;

        await Promise.all([
            supabase.from("users").update({ balance: newBalance }).eq("id", userId),
            supabase.from("orders").insert({
                user_id: userId,
                service_name: serviceName, // 🔥 PERBAIKAN: Gunakan variabel nama yang didapat dari teks
                phone_number: number,
                activation_id: actId,
                price: hargaJual, 
                status: "active"
            })
        ]);

        const startTime = Date.now();
        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Jakarta",
                hour12: false
            }).replace(/\./g, ":");

        const msg =
`✅ *ORDER BERHASIL*

📦 *Layanan :* ${esc(serviceName)}
📱 *Nomor :* \`${number}\`
💰 *Harga :* ${esc(formatRp(hargaJual))}
💵 *Saldo :* ${esc(formatRp(newBalance))}

📩 *OTP CODE :* Waiting For OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await bot.telegram.deleteMessage(ctx.chat.id, currentLoadingId).catch(()=>{});

        const sentMsg = await ctx.reply(msg, {
            parse_mode: "MarkdownV2",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "❌ Batal / Refund", callback_data: `cancel_smscode_${actId}` }]
                ]
            }
        });

        pollSmscode(
            userId,
            sentMsg.message_id,
            actId,
            serviceName, // 🔥 PERBAIKAN: Kirim nama ke polling
            number,
            startTime,
            ""
        );

    } catch (e) {
        console.error("Buy SMSCode Error:", e.message);
        if (currentLoadingId) {
            await bot.telegram.editMessageText(
                ctx.chat.id,
                currentLoadingId,
                null,
                "❌ Terjadi kesalahan sistem.",
                {
                    // 🔥 FIX: Kembali presisi
                    reply_markup: {
                        inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `smscode_list_Server3_${serviceId}` }]]
                    }
                }
            ).catch(()=>{});
        } else {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(()=>{});
        }
    } finally {
        setTimeout(() => {
            activeTransactions.delete(userId);
        }, 1500);
    }
});

bot.action(/cancel_smscode_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK (RAM)
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. CEK ORDER & VALIDASI UI
        // =========================
        const { data: ord } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId)
            .maybeSingle();

        // 🔥 PERBAIKAN: Jika sudah mati, munculkan popup LALU hapus tombolnya
        if (!ord || ord.status !== 'active') {
            await ctx.answerCbQuery("❌ Pesanan sudah tidak aktif.", { show_alert: true }).catch(()=>{});
            
            // Lenyapkan tombol agar user tidak spam klik
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 2. LIMIT 120 DETIK
        // =========================
        const startTime = new Date(ord.created_at).getTime();
        const diffSeconds = Math.floor((Date.now() - startTime) / 1000);

        if (diffSeconds < 120) {
            return ctx.answerCbQuery(
                `⚠️ Tunggu ${120 - diffSeconds} detik lagi.`,
                { show_alert: true }
            ).catch(()=>{});
        }

        // =========================
        // 3. LOCK DB
        // =========================
        const { data: locked } = await supabase
            .from('orders')
            .update({ status: 'processing_cancel' })
            .eq('activation_id', actId)
            .eq('status', 'active')
            .select();

        if (!locked || locked.length === 0) {
            await ctx.answerCbQuery("⚠️ Sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
            // Opsional: Lenyapkan tombol juga di sini karena berarti ada tabrakan proses
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 4. API PROVIDER
        // =========================
        let res;
        try {
            res = await axios.post(
                'https://api.smscode.gg/v1/orders/cancel',
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000 // 🔥 Aman dari timeout Telegram
                }
            );
        } catch (err) {
            res = err.response;
        }

        if (!res || !res.data) {
            // Rollback DB karena gagal request ke provider
            await supabase
                .from('orders')
                .update({ status: 'active' })
                .eq('activation_id', actId);

            // Pesan instruksi KLIK ULANG
            return ctx.answerCbQuery("❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Batal.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // ✅ SUCCESS CANCEL
        // =========================
        if (res.data.success) {

            await ctx.answerCbQuery("⏳ Memproses refund...").catch(()=>{});

            const refundAmount = Number(ord.price) || 0;

            const { error: refundError } = await supabase.rpc('increment_balance', {
                user_id: userId,
                amount: refundAmount
            });

            if (refundError) {
                console.log("❌ REFUND ERROR:", refundError.message);
            }

            await supabase
                .from('orders')
                .update({ status: 'cancelled' })
                .eq('activation_id', actId)
                .eq('status', 'processing_cancel'); 

            // 🔥 UBAH UI: Format teks sama persis dengan foto dan ada tombol tambahan
            const msgCancel =
`❌ *Order Dibatalkan*

📦 Layanan : ${esc(ord.service_name)}
📱 Nomor : \`${esc(ord.phone_number)}\`

💰 Refund : ${esc(formatRp(refundAmount))}
💳 Saldo telah dikembalikan ke akun Anda`;

            return ctx.editMessageText(msgCancel, {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Order Ulang', callback_data: 'server3' }],
                        [{ text: '🔙 Menu Utama', callback_data: 'start' }]
                    ]
                }
            }).catch(()=>{});
        }

        // =========================
        // ❌ ERROR PROVIDER API
        // =========================
        // Rollback karena ditolak provider
        await supabase
            .from('orders')
            .update({ status: 'active' })
            .eq('activation_id', actId);

        const apiError = res.data?.error?.code;
        const apiMessage = res.data?.message;
        
        // Log untuk admin
        console.log(`[SMSCODE REJECT] ID: ${actId} | Error: ${apiError} | Msg: ${apiMessage}`);

        if (apiError === "CANCEL_TOO_EARLY") {
            return ctx.answerCbQuery(`⚠️ ${apiMessage || "Terlalu cepat untuk batal."}`, { show_alert: true }).catch(()=>{});
        }

        return ctx.answerCbQuery(
            `⚠️ ${apiMessage || "Gagal membatalkan pesanan. Silakan coba lagi."}`,
            { show_alert: true }
        ).catch(()=>{});

    } catch (e) {
        console.error("Error Cancel SMSCode:", e.message);

        ctx.answerCbQuery(
            "❌ Terjadi kesalahan sistem.",
            { show_alert: true }
        ).catch(()=>{});
    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/resend_smscode_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. VALIDASI DATA
        // =========================
        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) {
            return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        }

        if (order.status !== "active") {
            return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 2. API RESEND (TIMEOUT DITAMBAH & ERROR DITANGKAP)
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/resend",
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 15000 // 🔥 Naikkan jadi 15 detik biar nggak gampang timeout
                }
            );
        } catch (err) {
            // 🔥 Tangkap pesan error ASLI dari API SMSCode (jika ada)
            const errorMsg = err.response?.data?.message || err.response?.data?.error?.message || "Koneksi pusat sibuk/Timeout. Coba lagi.";
            console.log(`❌ Error API Resend SMSCode [${actId}]:`, errorMsg);
            
            return ctx.answerCbQuery(`❌ Gagal: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        if (!res || !res.data || !res.data.success) {
            const errorMsg =
                res?.data?.error?.message ||
                res?.data?.message ||
                "Terjadi gangguan pada server pusat";

            return ctx.answerCbQuery(`⚠️ Gagal meminta SMS: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 3. SUCCESS - MATIKAN LOADING TOMBOL
        // =========================
        await ctx.answerCbQuery("✅ Berhasil meminta SMS baru...").catch(()=>{});

        // =========================
        // 4. HITUNG WAKTU & SALDO
        // =========================
        const startTime = new Date(order.created_at).getTime();
        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit", 
                timeZone: "Asia/Jakarta",
                hour12: false
            })
            .replace(/\./g, ":");

        const { data: user } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        // =========================
        // 5. MESSAGE SUCCESS (Ubah UI)
        // =========================
        const oldOtpCode = order.sms_code ? esc(order.sms_code) : "\\-";

        // 🔥 UI Diperbarui, bagian 'SMS Text' dihilangkan jika sedang menunggu
        const msg =
`⏳ *MENUNGGU SMS BARU*

📦 *Layanan :* ${esc(order.service_name)}
📱 *Nomor :* \`${esc(order.phone_number)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

📩 *OTP LAMA :* \`${oldOtpCode}\`

📩 *OTP BARU :* Waiting For New OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
            // Tidak perlu kirim reply_markup tombol lagi di sini, biarkan UI hanya menampilkan pesan info.
            // Saat OTP baru masuk, fungsi pollSmscode akan memberikan tombol lagi.
        }).catch(()=>{});

        // 🔥 CRITICAL FIX: HAPUS PEMANGGILAN `pollSmscode` DI SINI!
        // Polling yang asli di background MASIH JALAN. Dia akan otomatis 
        // mendeteksi jika ada SMS baru dari Webhook/Fallback dan mengupdate UI.

    } catch (e) {
        console.error("❌ RESEND SMSCODE ERROR:", e.message);

        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{});
        } catch (err) {}

    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/finish_smscode_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        if (order.status !== "active") return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});

        let latestOtp = "";
        
        try {
            const apiRes = await axios.get(
                `https://api.smscode.gg/v1/orders/${actId}`,
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, timeout: 8000 }
            );

            if (apiRes.data.success) {
                latestOtp = apiRes.data.data?.otp_code || "";
            }
        } catch (err) {}

        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/finish",
                { id: parseInt(actId) },
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`, "Content-Type": "application/json" }, timeout: 8000 }
            );
        } catch (err) {
            return ctx.answerCbQuery("❌ Koneksi sibuk. Silakan KLIK ULANG tombol Selesai.", { show_alert: true }).catch(()=>{});
        }

        const result = res?.data;

        if (!result?.success && result?.data?.status !== "COMPLETED") {
            const errMsg = result?.error?.message || result?.message || "Status pesanan tidak valid";
            return ctx.answerCbQuery(`⚠️ Gagal menyelesaikan: ${errMsg}`, { show_alert: true }).catch(()=>{});
        }

        await ctx.answerCbQuery("✅ Order Selesai!").catch(()=>{});

        if (latestOtp) {
            await supabase.from("orders").update({ sms_code: latestOtp }).eq("activation_id", actId);
        }

        await supabase.from("orders").update({ status: "completed" }).eq("activation_id", actId).eq("status", "active");

        // 🔥 UBAH UI: Format Sesuai Foto (Tanpa Tombol)
        const msg =
`✅ *ORDER SELESAI*

📦 Layanan: ${esc(order.service_name)}
📱 Nomor : \`${esc(order.phone_number)}\`
💰 Harga : Rp ${esc(order.price.toLocaleString('id-ID'))}

🙏 Terima kasih telah menggunakan layanan kami\\!`;

        return ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
        }).catch(()=>{});

    } catch (e) {
        console.error("❌ ERROR FINISH:", e.message);
        try { await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{}); } catch(err){}
    } finally {
        activeTransactions.delete(userId);
    }
});

bot.command("hargasmscode", async (ctx) => {

    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();

    if (!text) {
        return ctx.reply("❌ Gunakan format:\n/hargasmscode <layanan>");
    }

    try {

        const res = await axios.get(
            "https://api.smscode.gg/v1/catalog/products",
            {
                params: {
                    country_id: 7,
                    limit: 5000
                },
                headers: {
                    Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`
                }
            }
        );

        if (!res.data.success) {
            return ctx.reply("❌ Gagal mengambil data dari provider.");
        }

        const keyword = text.toLowerCase();

        const results = (res.data.data || []).filter(p =>
            p.name.toLowerCase().includes(keyword)
        );

        if (results.length === 0) {
            return ctx.reply(`❌ Layanan "${text}" tidak ditemukan.`);
        }

        // =========================
        // FORMAT OUTPUT
        // =========================
        let msg = `📊 *HASIL PENCARIAN: ${text.toUpperCase()}*\n\n`;

        results.slice(0, 15).forEach(p => {
            msg +=
`🆔 ID: \`${p.id}\`
📦 ${p.name}
💰 Modal: ${p.price}
📊 Stok: ${p.available}

`;
        });

        msg += `────────────────\nTotal: ${results.length} layanan`;

        await ctx.reply(msg, {
            parse_mode: "Markdown"
        });

    } catch (e) {
        ctx.reply("❌ Terjadi kesalahan saat mengambil data.");
    }

});

bot.command("editprodid", async (ctx) => {

    const ADMIN_ID = process.env.ADMIN_ID;

    if (String(ctx.from.id) !== String(ADMIN_ID)) {
        return ctx.reply("❌ Tidak punya akses.");
    }

    const args = ctx.message.text.split(" ").slice(1);

    if (args.length < 2) {
        return ctx.reply("❌ Format salah\n\nGunakan:\n/editprodid <id> <prod_id_baru>");
    }

    const localId = args[0];
    const newProdId = args[1];

    try {

        // =========================
        // CEK DATA
        // =========================
        const { data: item } = await supabase
            .from("services_smscode")
            .select("*")
            .eq("id", localId)
            .maybeSingle();

        if (!item) {
            return ctx.reply("❌ Data tidak ditemukan.");
        }

        // =========================
        // UPDATE PROVIDER ID
        // =========================
        await supabase
            .from("services_smscode")
            .update({ provider_id: parseInt(newProdId) })
            .eq("id", localId);

        // =========================
        // RESPONSE
        // =========================
        const msg =
`✅ PROD ID BERHASIL DIUPDATE

🆔 ID: ${localId}
📦 Layanan: ${item.name}
🔁 Prod ID Lama: ${item.provider_id}
🆕 Prod ID Baru: ${newProdId}`;

        await ctx.reply(msg);

    } catch (e) {
        console.error(e);
        ctx.reply("❌ Terjadi kesalahan saat update.");
    }

});

bot.command("editharga_smscode", async (ctx) => {

    const userId = ctx.from.id.toString();
    const ADMIN_ID = process.env.ADMIN_ID;

    // =========================
    // CEK ADMIN
    // =========================
    if (userId !== ADMIN_ID) {
        return ctx.reply("❌ Kamu tidak memiliki akses.");
    }

    try {

        const args = ctx.message.text.split(" ");

        // =========================
        // VALIDASI INPUT
        // =========================
        if (args.length < 3) {
            return ctx.reply(
                "⚠️ Format salah\n\nGunakan:\n/editharga_smscode <id> <harga>"
            );
        }

        const id = parseInt(args[1]);
        const harga = parseInt(args[2]);

        if (isNaN(id) || isNaN(harga)) {
            return ctx.reply("❌ ID dan harga harus berupa angka.");
        }

        // =========================
        // CEK DATA
        // =========================
        const { data: service } = await supabase
            .from("services_smscode")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (!service) {
            return ctx.reply("❌ Service tidak ditemukan.");
        }

        // =========================
        // UPDATE HARGA
        // =========================
        await supabase
            .from("services_smscode")
            .update({ price: harga })
            .eq("id", id);

        // =========================
        // RESPONSE
        // =========================
        const msg =
`✅ HARGA BERHASIL DIUPDATE

🆔 ID       : ${id}
📦 Layanan  : ${service.name}

?? Harga Lama : ${formatRp(service.price)}
💰 Harga Baru : ${formatRp(harga)}`;

        ctx.reply(msg);

    } catch (e) {

        console.log("ERROR EDIT HARGA:", e.message);

        ctx.reply("❌ Gagal mengupdate harga.");
    }

});

bot.command("delsmscode", async (ctx) => {

    const userId = ctx.from.id.toString();
    const ADMIN_ID = process.env.ADMIN_ID;

    // =========================
    // CEK ADMIN
    // =========================
    if (userId !== ADMIN_ID) {
        return ctx.reply("❌ Kamu tidak memiliki akses.");
    }

    try {

        const args = ctx.message.text.split(" ");

        // =========================
        // VALIDASI INPUT
        // =========================
        if (args.length < 2) {
            return ctx.reply(
                "⚠️ Format salah\n\nGunakan:\n/delsmscode <id>"
            );
        }

        const id = parseInt(args[1]);

        if (isNaN(id)) {
            return ctx.reply("❌ ID harus berupa angka.");
        }

        // =========================
        // CEK DATA
        // =========================
        const { data: service } = await supabase
            .from("services_smscode")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (!service) {
            return ctx.reply("❌ Service tidak ditemukan.");
        }

        // =========================
        // HAPUS DATA
        // =========================
        await supabase
            .from("services_smscode")
            .delete()
            .eq("id", id);

        // =========================
        // RESPONSE
        // =========================
        const msg =
`🗑️ LAYANAN BERHASIL DIHAPUS

🆔 ID       : ${id}
📦 Layanan  : ${service.name}
💰 Harga    : ${formatRp(service.price)}`;

        ctx.reply(msg);

    } catch (e) {

        console.log("ERROR DELETE SMSCODE:", e.message);

        ctx.reply("❌ Gagal menghapus layanan.");
    }

});

bot.command('addwaluar', async (ctx) => {
    // Pastikan admin (Gunakan pengecekan array jika admin lebih dari satu)
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const args = ctx.message.text.split(' ');

    if (args.length < 5) {
        return ctx.reply(
            "⚠️ Format: `/addwaluar <country_id> <prod_id> <harga> <nama>`",
            { parse_mode: 'Markdown' }
        );
    }

    const countryId = parseInt(args[1]);
    const productId = parseInt(args[2]);
    const price = parseInt(args[3]);
    const name = args.slice(4).join(' ');

    try {
        const { error } = await supabase
            .from('wa_luar')
            .insert([{
                provider_id: productId,
                name: name,
                price: price,
                country_id: countryId,
                server_id: 4, // 🔥 FIX: Gunakan server_id dan isi dengan angka 4
                is_active: true
            }]);

        if (error) throw error;

        // 🔄 Reset Cache Server 4 agar langsung muncul di menu
        if (typeof cacheServices !== 'undefined' && cacheServices[4]) {
            cacheServices[4] = [];
            lastServiceUpdate[4] = 0;
        }

        const text =
`✅ *BERHASIL TAMBAH LAYANAN S4*

📦 Layanan : *${esc(name)}*
🆔 Prod ID : \`${productId}\`
💰 Harga   : *${esc(formatRp(price))}*
🌐 Negara  : \`${countryId}\``;

        await ctx.reply(text, { parse_mode: 'MarkdownV2' });

    } catch (e) {
        // Jika masih error "column not found", pastikan sudah jalankan SQL "reload schema" di dashboard
        ctx.reply("❌ Gagal: " + e.message);
    }
});

bot.command("hargasmscode2", async (ctx) => {

    const args = ctx.message.text.split(" ").slice(1);

    if (args.length < 2) {
        return ctx.reply("❌ Format:\n/hargasmscode2 <country_id> <layanan>");
    }

    const countryId = parseInt(args[0]);
    const text = args.slice(1).join(" ").trim();

    if (isNaN(countryId)) {
        return ctx.reply("❌ Country ID harus berupa angka.");
    }

    try {

        // =========================
        // 1. AMBIL DATA NEGARA
        // =========================
        const countryRes = await axios.get(
            "https://api.smscode.gg/v1/catalog/countries",
            {
                headers: {
                    Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`
                }
            }
        );

        let countryName = `ID ${countryId}`;
        let countryEmoji = "";

        if (countryRes.data.success) {
            const found = countryRes.data.data.find(c => c.id === countryId);
            if (found) {
                countryName = found.name;
                countryEmoji = found.emoji || "";
            }
        }

        // =========================
        // 2. AMBIL PRODUK
        // =========================
        const res = await axios.get(
            "https://api.smscode.gg/v1/catalog/products",
            {
                params: {
                    country_id: countryId,
                    limit: 5000
                },
                headers: {
                    Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`
                }
            }
        );

        if (!res.data.success) {
            return ctx.reply("❌ Gagal mengambil data dari provider.");
        }

        const keyword = text.toLowerCase();

        const results = (res.data.data || []).filter(p =>
            p.name.toLowerCase().includes(keyword)
        );

        if (results.length === 0) {
            return ctx.reply(`❌ Layanan "${text}" tidak ditemukan di ${countryName}.`);
        }

        // =========================
        // FORMAT OUTPUT
        // =========================
        let msg = `${countryEmoji} *NEGARA: ${countryName} (ID: ${countryId})*\n`;
        msg += `📊 *HASIL: ${text.toUpperCase()}*\n\n`;

        results.slice(0, 15).forEach(p => {
            msg +=
`🆔 ID: \`${p.id}\`
📦 ${p.name}
💰 Modal: ${p.price}
📊 Stok: ${p.available}

`;
        });

        msg += `────────────────\nTotal: ${results.length} layanan`;

        await ctx.reply(msg, {
            parse_mode: "Markdown"
        });

    } catch (e) {
        console.log(e.message);
        ctx.reply("❌ Terjadi kesalahan saat mengambil data.");
    }

});

bot.command("editlayanan3", async (ctx) => {

    // 🔒 ADMIN ONLY
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const args = ctx.message.text.split(" ").slice(1);

    if (args.length < 2) {
        return ctx.reply("❌ Format:\n/editlayanan3 <id_db> <nama_baru>");
    }

    const id = parseInt(args[0]);
    const newName = args.slice(1).join(" ");

    if (isNaN(id)) {
        return ctx.reply("❌ ID harus berupa angka.");
    }

    try {

        // =========================
        // UPDATE BERDASARKAN ID DB
        // =========================
        const { data, error } = await supabase
            .from('services_smscode')
            .update({ name: newName })
            .eq('id', id)          // 🔥 PAKAI ID DATABASE
            .eq('server', 3)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return ctx.reply("❌ Layanan tidak ditemukan.");
        }

        // =========================
        // RESET CACHE
        // =========================
        if (typeof cacheServices !== 'undefined') {
            cacheServices[3] = [];
            lastServiceUpdate[3] = 0;
        }

        // =========================
        // RESPONSE
        // =========================
        const msg =
`✏️ *UPDATE LAYANAN S3*

🆔 ID DB      : \`${id}\`
📦 Nama Baru  : *${esc(newName)}*

✅ Berhasil diupdate`;

        await ctx.reply(msg, {
            parse_mode: "MarkdownV2"
        });

    } catch (e) {
        console.log(e.message);
        ctx.reply("❌ Gagal update layanan.");
    }

});

// --- 6. HISTORY ---
bot.action('hist_order', async (ctx) => {

    // 🔥 WAJIB: hilangkan loading tombol
    await ctx.answerCbQuery().catch(()=>{});

    try {

        // =========================
        // 🔥 PARALLEL QUERY (SUPER RINGAN & FIX BUGS)
        // =========================
        const [res1, res2] = await Promise.all([
            supabase.from('orders')
                .select('status, price, created_at, service_name, phone_number, sms_code')
                .eq('user_id', ctx.from.id)
                .order('created_at', { ascending: false }), // 🔥 PERBAIKAN: Urutkan langsung dari DB
            supabase.from('orders_multi')
                .select('status, price_refund, created_at, service_name, phone_number, sms_code') 
                .eq('user_id', ctx.from.id)
                .order('created_at', { ascending: false })  // 🔥 PERBAIKAN: Urutkan langsung dari DB
        ]);

        // 🔥 DEBUG LOG: Akan muncul di terminal Termius jika masih ada nama kolom yang salah
        if (res1.error) console.error("❌ DB Orders Error:", res1.error.message);
        if (res2.error) console.error("❌ DB Multi Error:", res2.error.message);

        const orders = res1.data || [];
        const ordersMulti = res2.data || [];

        const normalOrders = orders.map(o => ({
            ...o,
            source: 'single'
        }));

        const multiOrders = ordersMulti.map(o => ({
            ...o,
            source: 'multi'
        }));

        const allOrders = [...normalOrders, ...multiOrders];

        // =========================
        // SORT GABUNGAN (Finalisasi)
        // =========================
        allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const totalOrders = allOrders.length;

        let totalSpent = 0;

        allOrders.forEach(o => {
            if (o.status === 'completed') {
                // Sangat aman karena akan mendeteksi price_refund (dari multi) atau price (dari normal)
                totalSpent += Number(o.price_refund || o.price || 0);
            }
        });

        const lastOrders = allOrders.slice(0, 5);

        let msg =
`📦 *ORDER HISTORY*
━━━━━━━━━━━━━━
📊 Total Order : *${esc(totalOrders.toString())}*
💰 Total Belanja : *${esc(formatRp(totalSpent))}*

💵 *5 Order Terakhir:*

`;

        if (lastOrders.length > 0) {

            lastOrders.forEach(o => {

                const e = (t) => t ? esc(t.toString()) : '\\-';

                let icon =
                    o.status === 'completed' ? '✅' :
                    o.status === 'cancelled' ? '❌' :
                    '⏳';

                let statusText =
                    o.status === 'completed' ? 'Completed' :
                    o.status === 'cancelled' ? 'Cancelled' :
                    'Waiting SMS';

                const orderDate = new Date(o.created_at).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Jakarta'
                }).replace(/\./g, ':');

                const label = o.source === 'multi' ? ' 🔗MULTI' : '';

                msg +=
`${icon} *${e(o.service_name)}${label}*
📱 \`${e(o.phone_number)}\`
💬 Code : \`${e(o.sms_code)}\`
📊 Status : ${e(statusText)}
📅 ${e(orderDate)} WIB

━━━━━━━━━━━━━━

`;

            });

        } else {

            msg += "Belum ada riwayat order\\.";

        }

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: 'start' }]
                ]
            }
        }).catch(()=>{}); // 🔥 cegah crash edit

    } catch (err) {

        console.error("HIST ERROR:", err.message);

        ctx.answerCbQuery("Gagal memuat history.", {
            show_alert: true
        }).catch(()=>{});

    }
});

//// SERVER 4 WA LUAR ////
async function pollWaLuar(
    chatId,
    messageId,
    activationId,
    serviceName,
    phoneNumber,
    startTime,
    lastSms = "",
    isResend = false
) {
    const DURATION_LIMIT = 20 * 60 * 1000; // 20 Menit

    try {
        const { data: order, error: dbError } = await supabase
            .from("orders")
            .select("status, sms_code, price") // 🔥 Murni hanya baca kolom yang ada (Super Ringan)
            .eq("activation_id", activationId)
            .maybeSingle();

        if (dbError) {
            console.log(`[DEBUG-ERROR] Supabase Error:`, dbError.message);
            // Coba lagi 10 detik kemudian, JANGAN RETURN MATI!
            return setTimeout(() => pollWaLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
        }
        
        if (!order || order.status !== "active") return;

        const now = Date.now();
        const timeElapsed = now - startTime;

        // 🔥 FILTER UI: Hapus kata "WhatsApp " di awal kalimat agar UI konsisten menggunakan format "Negara :"
        const displayCountry = serviceName.replace(/^WhatsApp\s+/i, '');

        // ============================
        // ⏰ EXPIRED & ANTI-RUGI
        // ============================
        if (timeElapsed >= DURATION_LIMIT) {
            console.log(`⏰ [WA Luar] Waktu habis untuk nomor: ${phoneNumber}`); 

            let shouldRefund = false;
            let smsFound = order.sms_code || lastSms;

            try {
                const checkRes = await axios.get(
                    `https://api.smscode.gg/v1/orders/${activationId}`,
                    { 
                        headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                        timeout: 20000 
                    }
                );

                if (checkRes.data && checkRes.data.success) {
                    const apiStatus = checkRes.data.data.status;

                    if (apiStatus === "EXPIRED" || apiStatus === "CANCELLED" || apiStatus === "TIMEOUT") {
                        shouldRefund = true;
                    } 
                    else if (apiStatus === "COMPLETED" || apiStatus === "OTP_RECEIVED" || checkRes.data.data.otp_code) {
                        shouldRefund = false;
                        smsFound = true;
                    } 
                    else {
                        const cancelRes = await axios.post(
                            "https://api.smscode.gg/v1/orders/cancel",
                            { id: parseInt(activationId) },
                            { 
                                headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, 
                                timeout: 20000 
                            }
                        );
                        if (cancelRes.data && cancelRes.data.success) shouldRefund = true;
                    }
                }
            } catch (err) {
                if (!smsFound) shouldRefund = true;
            }

            const finalStatus = shouldRefund ? "cancelled" : "completed";
            const { data: updated, error: updateErr } = await supabase
                .from("orders")
                .update({ status: finalStatus })
                .eq("activation_id", activationId)
                .eq("status", "active")
                .select();

            if (updateErr) {
                return setTimeout(() => pollWaLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
            }

            if (!updated || updated.length === 0) return;

            // ============================
            // ✅ UI UPDATE & REFUND
            // ============================
            if (smsFound || !shouldRefund) {
                const msgDone =
`✅ *ORDER WHATSAPP SELESAI*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}

⌛ Masa aktif habis\\. Pesanan selesai otomatis\\.`;

                await safeEditMessage(bot, chatId, messageId, msgDone, { parse_mode: "MarkdownV2" });
            } else {
                const refund = Number(order.price) || 0;
                const { error: refundError } = await supabase.rpc('increment_balance', { user_id: chatId, amount: refund });

                if (refundError) {
                    console.log("❌ REFUND ERROR:", refundError.message);
                } else {
                    console.log(`💰 [WA Luar] Saldo ${refund} direfund untuk ${phoneNumber}`); 
                }

                const msgExpire =
`⏰ *WAKTU WHATSAPP HABIS*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`

💰 Saldo ${esc(formatRp(refund))} dikembalikan\\.`;

                await safeEditMessage(bot, chatId, messageId, msgExpire, { parse_mode: "MarkdownV2" });
            }
            return;
        }

        // ===============================
        // 3. PROSES OTP (Hybrid: Webhook + Fallback API)
        // ===============================
        let newCode = order.sms_code;
        let smsFullText = ""; 

        // 🔥 PERBAIKAN 1: Menggunakan variabel 'lastSms' sesuai parameter
        if (!newCode || newCode === lastSms) {
            try {
                const res = await axios.get(
                    "https://api.smscode.gg/v1/orders/active",
                    {
                        headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
                        timeout: 10000 // Timeout cepat
                    }
                );

                if (res.data && res.data.success) {
                    const apiOrder = (res.data.data || []).find(o => String(o.id) === String(activationId));

                    if (apiOrder && apiOrder.status === "OTP_RECEIVED" && apiOrder.otp_code) {
                        const fetchedCode = apiOrder.otp_code;

                        // Pastikan kode yang didapat adalah OTP baru (bukan OTP lama)
                        if (fetchedCode && fetchedCode !== lastSms) {
                            newCode = fetchedCode;
                            smsFullText = apiOrder.otp_message || apiOrder.sms_text || "\\-";
                            
                            await supabase.from("orders").update({ sms_code: newCode }).eq("activation_id", activationId);
                            console.log(`🛡️ [Fallback WA Luar] Berhasil jemput kode BARU dari API untuk ${phoneNumber}`);
                        }
                    }
                }
            } catch (err) {
                // Abaikan error (timeout/dsb), biar loop jalan terus tanpa spam
            }
        }

        // ===============================
        // 🔥 UPDATE UI JIKA OTP BARU MASUK
        // ===============================
        if (newCode && newCode !== lastSms) {
            
            const cleanCode = newCode.trim();
            console.log(`✅ [WA Luar] OTP MASUK UNTUK ${phoneNumber} : ${cleanCode}`); 

            const { data: user } = await supabase.from("users").select("balance").eq("id", chatId).maybeSingle();

            const expiryTime = new Date(startTime + DURATION_LIMIT)
                .toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                .replace(/\./g, ":");

            // 🔥 PERBAIKAN 2: Deteksi dinamis multi-OTP
            let smsDisplay = `📩 *OTP CODE :* \`${esc(cleanCode)}\``;
            if (lastSms && lastSms !== cleanCode) {
                smsDisplay = `📩 *OTP LAMA :* \`${esc(lastSms)}\`\n📩 *OTP BARU :* \`${esc(cleanCode)}\``;
            }

            const msgUpdate =
`✅ *ORDER WHATSAPP BERHASIL*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(phoneNumber)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

${smsDisplay}

📄 *SMS Text :*
\`${esc(smsFullText) || "\\-"}\`

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

            try {
                // Tombol inline_keyboard dibiarkan persis seperti semula
                await bot.telegram.editMessageText(chatId, messageId, null, msgUpdate, {
                    parse_mode: "MarkdownV2",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📩 Request SMS Lagi", callback_data: `resend_WaLuar_${activationId}` }],
                            [{ text: "✅ Selesai", callback_data: `finish_WaLuar_${activationId}` }]
                        ]
                    }
                });

                // Update memori jika sukses
                lastSms = cleanCode;

            } catch (err) {
                if (err.message && err.message.includes('message is not modified')) {
                    lastSms = cleanCode;
                } else {
                    console.error("❌ [WA Luar EDIT ERROR]", err.message);
                    throw err; 
                }
            }
        }

        // ===============================
        // 4. LOOPING (PENURUN PANAS CPU)
        // ===============================
        const delay = lastSms ? 15000 : 8000;

        setTimeout(() => {
            pollWaLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend);
        }, delay);

    } catch (e) {
        console.error(`❌ [WA Luar] Poll Error [${phoneNumber}]:`, e.message); 
        setTimeout(() => pollWaLuar(chatId, messageId, activationId, serviceName, phoneNumber, startTime, lastSms, isResend), 10000);
    }
}

// =========================================
// 🌍 HANDLER: PILIH 5 PROVIDER (SERVER 4 / WA LUAR)
// =========================================
bot.action(/^waluar_list_(.+)_(\d+)$/, async (ctx) => {
    // rawName = Nama Negara, apiCountryId = ID Negara dari API SMSCode
    const rawName = ctx.match[1]; 
    const apiCountryId = Number(ctx.match[2]); 
    const backButton = [{ text: "⬅️ Kembali", callback_data: "page_4_0" }]; // 🔥 FIX: Tombol kembali seragam
    
    try {
        // 🔥 Transisi smooth: Hanya popup loading
        await ctx.answerCbQuery(`🔍 Mencari stok WA ${rawName}...`).catch(() => {});

        // 🔥 LANGSUNG TEMBAK API: Platform ID 1 = WhatsApp
        const res = await axios.get("https://api.smscode.gg/v1/catalog/products", {
            params: { country_id: apiCountryId, platform_id: 1, limit: 100 },
            headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` },
            timeout: 10000
        });

        if (!res.data || !res.data.success) {
            return ctx.editMessageText("❌ Gagal mengambil data dari provider.", {
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        const allProducts = res.data.data || [];

        // 🔥 FIX: Filter Stok > 20 & Ambil 16 Termurah (Biar pas 8 baris Kiri-Kanan)
        const filtered = allProducts
            .filter(p => p.available >= 20)
            .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
            .slice(0, 16);

        if (filtered.length === 0) {
            return ctx.editMessageText(`❌ Maaf, saat ini tidak ada stok WA yang tersedia di atas 20 untuk negara *${rawName.toUpperCase()}*.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [backButton] }
            }).catch(()=>{});
        }

        // 🔥 KEUNTUNGAN MUTLAK 2000
        const profit = 2000;

        // ========================================================
        // 🔥 SUSUN TOMBOL JADI 2 KOLOM (KIRI & KANAN)
        // ========================================================
        const buttons = [];

        for (let i = 0; i < filtered.length; i += 2) {
            const row = [];

            // Tombol Kolom Kiri
            const itemLeft = filtered[i];
            const hargaKiri = Math.round(itemLeft.price) + profit;
            const formatKiri = `Rp. ${hargaKiri.toLocaleString('id-ID')} | Stok ${itemLeft.available}`;
            row.push(
                Markup.button.callback(
                    formatKiri, 
                    `buy_waluar_${itemLeft.id}_${hargaKiri}_${apiCountryId}` 
                )
            );

            // Tombol Kolom Kanan (Hanya ditambahkan jika datanya ada)
            if (filtered[i + 1]) {
                const itemRight = filtered[i + 1];
                const hargaKanan = Math.round(itemRight.price) + profit;
                const formatKanan = `Rp. ${hargaKanan.toLocaleString('id-ID')} | Stok ${itemRight.available}`;
                row.push(
                    Markup.button.callback(
                        formatKanan, 
                        `buy_waluar_${itemRight.id}_${hargaKanan}_${apiCountryId}` 
                    )
                );
            }

            buttons.push(row);
        }

        // Masukkan tombol kembali di baris paling bawah secara full-width
        buttons.push(backButton);

        const textPesan = `✨ *PILIHAN STOK WA: ${rawName.toUpperCase()}*\n\n` +
                          `Berikut adalah pilihan harga yang tersedia saat ini:\n\n` +
                          `_Pilih harga yang menurut Anda paling stabil:_`;

        await ctx.editMessageText(textPesan, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        }).catch(()=>{});

    } catch (e) {
        console.error("List WA Luar Error:", e.message);
        await ctx.editMessageText("❌ Terjadi kesalahan sistem saat mengambil data dari pusat.", {
            reply_markup: { inline_keyboard: [backButton] }
        }).catch(()=>{});
    }
});

// =========================================
// 🛒 HANDLER: PROSES BELI WA LUAR (SERVER 4)
// =========================================
bot.action(/^buy_waluar_(\d+)_(\d+)_(\d+)$/, async (ctx) => {

    const providerId = Number(ctx.match[1]); // ID Product API
    const hargaJual = Number(ctx.match[2]);  // Harga Jual (+ Untung 2000)
    const apiCountryId = Number(ctx.match[3]);  // COUNTRY ID API

    const userId = ctx.from.id;

    // 🔒 1. ANTI SPAM & DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);
    let currentLoadingId = null;

    try {
        await checkUser(ctx);

        // =========================
        // 2. AMBIL NAMA NEGARA & PERCANTIK POSISI BENDERA
        // =========================
        const msgText = ctx.callbackQuery.message.text || "";
        const nameMatch = msgText.match(/PILIHAN STOK WA:\s*(.+)/i);
        let countryName = nameMatch ? nameMatch[1].trim() : "WA Luar Negeri";

        if (!isNaN(countryName) || countryName === "WA Luar Negeri") {
            try {
                const countryRes = await axios.get("https://api.smscode.gg/v1/catalog/countries", {
                    headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }
                });
                if (countryRes.data && countryRes.data.success) {
                    const foundCountry = countryRes.data.data.find(c => c.id === apiCountryId);
                    if (foundCountry) countryName = `${foundCountry.emoji} ${foundCountry.name}`; 
                }
            } catch (err) {}
        }

        // 🔥 TRIK MAGIC: Pindahkan bendera ke KANAN (Misal: MALAYSIA 🇲🇾)
        let finalServiceName = countryName;
        const flagMatch = countryName.match(/^([^\w\s]+)\s*(.+)$/i); 
        if (flagMatch) {
            // flagMatch[1] adalah bendera, flagMatch[2] adalah teks negaranya
            finalServiceName = `${flagMatch[2]} ${flagMatch[1]}`;
        }

        // =========================
        // 3. CEK SALDO USER
        // =========================
        const { data: freshUser } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        if (!freshUser || freshUser.balance < hargaJual) {
            return ctx.answerCbQuery(
                `❌ Saldo tidak cukup!\nHarga: ${formatRp(hargaJual)}`,
                { show_alert: true }
            ).catch(()=>{});
        }

        // =========================
        // 4. LOGIKA ANTI-TIMPA
        // =========================
        await ctx.deleteMessage().catch(()=>{}); 

        const loadingMsg = await ctx.reply("⏳ Memproses order WhatsApp...");
        currentLoadingId = loadingMsg.message_id;

        await ctx.answerCbQuery().catch(()=>{});

        // =========================
        // 5. API REQUEST (ORDER)
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/create",
                {
                    product_id: providerId, 
                    country_id: apiCountryId,
                    quantity: 1
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000
                }
            );
        } catch (error) {
            if (error.response && error.response.data) {
                res = error.response; 
            } else {
                return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, "❌ Gagal terhubung ke server provider.", {
                    reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `waluar_list_${countryName}_${apiCountryId}` }]] }
                }).catch(()=>{});
            }
        }

        // =========================
        // DETEKSI STOK KOSONG / ERROR LAIN
        // =========================
        const orderDetail = res.data?.data?.orders?.[0];

        if (!res.data?.success || !orderDetail) {
            const rawMsg = String(res.data?.error?.message || res.data?.message || "Terjadi kesalahan");
            const lowerMsg = rawMsg.toLowerCase();
            
            if (lowerMsg.includes("stock") || lowerMsg.includes("available") || lowerMsg.includes("quantity") || lowerMsg.includes("no numbers")) {
                return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, `⚠️ Semua provider pada harga ini sedang kosong\nSilakan pilih harga lain.`, {
                    reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali Pilih Harga", callback_data: `waluar_list_${countryName}_${apiCountryId}` }]] }
                }).catch(()=>{});
            }

            return bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, `⚠️ Gagal order: ${rawMsg}`, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `waluar_list_${countryName}_${apiCountryId}` }]] }
            }).catch(()=>{});
        }

        // =========================
        // 6. SUCCESS & DB UPDATE
        // =========================
        const actId = String(orderDetail.id);
        const number = orderDetail.phone_number;
        const newBalance = freshUser.balance - hargaJual; 

        await Promise.all([
            supabase.from("users").update({ balance: newBalance }).eq("id", userId),
            supabase.from("orders").insert({
                user_id: userId,
                service_name: finalServiceName, // 🔥 Simpan nama cantik
                phone_number: number,
                activation_id: actId,
                price: hargaJual, 
                status: "active"
            })
        ]);

        const startTime = Date.now();
        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta", hour12: false })
            .replace(/\./g, ":");

        // 🔥 UBAH UI: Kembali menggunakan "Negara :" dan finalServiceName dengan bendera di kanan
        const msg =
`✅ *ORDER WHATSAPP BERHASIL*

📦 *Negara :* ${esc(finalServiceName)}
📱 *Nomor :* \`${number}\`
💰 *Harga :* ${esc(formatRp(hargaJual))}
💵 *Saldo :* ${esc(formatRp(newBalance))}

📩 *OTP CODE :* Waiting For OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await bot.telegram.deleteMessage(ctx.chat.id, currentLoadingId).catch(()=>{});

        const sentMsg = await ctx.reply(msg, {
            parse_mode: "MarkdownV2",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "❌ Batal / Refund", callback_data: `cancel_WaLuar_${actId}` }] 
                ]
            }
        });

        pollWaLuar(userId, sentMsg.message_id, actId, finalServiceName, number, startTime, "");

    } catch (e) {
        console.error("Buy S4 Error:", e.message);
        let countryNameFallback = "Luar Negeri";
        if (currentLoadingId) {
            await bot.telegram.editMessageText(ctx.chat.id, currentLoadingId, null, "❌ Terjadi kesalahan sistem.", {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: `waluar_list_${countryNameFallback}_${apiCountryId}` }]] }
            }).catch(()=>{});
        } else {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem.", { show_alert: true }).catch(()=>{});
        }
    } finally {
        setTimeout(() => { activeTransactions.delete(userId); }, 1500);
    }
});

bot.action(/cancel_WaLuar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK (RAM)
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. CEK ORDER & VALIDASI UI
        // =========================
        const { data: ord } = await supabase
            .from('orders')
            .select('*')
            .eq('activation_id', actId)
            .eq('user_id', userId)
            .maybeSingle();

        // 🔥 PERBAIKAN: Hapus tombol jika pesanan sudah mati
        if (!ord || ord.status !== 'active') {
            await ctx.answerCbQuery("❌ Pesanan sudah tidak aktif.", { show_alert: true }).catch(()=>{});
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 2. LIMIT 120 DETIK
        // =========================
        const startTime = new Date(ord.created_at).getTime();
        const diffSeconds = Math.floor((Date.now() - startTime) / 1000);

        if (diffSeconds < 120) {
            return ctx.answerCbQuery(
                `⚠️ Tunggu ${120 - diffSeconds} detik lagi.`,
                { show_alert: true }
            ).catch(()=>{});
        }

        // =========================
        // 3. LOCK DB
        // =========================
        const { data: locked } = await supabase
            .from('orders')
            .update({ status: 'processing_cancel' })
            .eq('activation_id', actId)
            .eq('status', 'active')
            .select();

        if (!locked || locked.length === 0) {
            await ctx.answerCbQuery("⚠️ Sudah diproses sebelumnya.", { show_alert: true }).catch(()=>{});
            // 🔥 PERBAIKAN: Hapus tombol jika tabrakan klik
            return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        }

        // =========================
        // 4. API PROVIDER
        // =========================
        let res;
        try {
            res = await axios.post(
                'https://api.smscode.gg/v1/orders/cancel',
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000 
                }
            );
        } catch (err) {
            res = err.response;
        }

        if (!res || !res.data) {
            // Rollback DB
            await supabase
                .from('orders')
                .update({ status: 'active' })
                .eq('activation_id', actId);

            return ctx.answerCbQuery("❌ Koneksi sedang sibuk. Silakan KLIK ULANG tombol Batal.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // ✅ SUCCESS CANCEL
        // =========================
        if (res.data.success) {

            await ctx.answerCbQuery("⏳ Memproses refund...").catch(()=>{});

            const refundAmount = Number(ord.price) || 0;

            const { error: refundError } = await supabase.rpc('increment_balance', {
                user_id: userId,
                amount: refundAmount
            });

            if (refundError) {
                console.log("❌ REFUND ERROR S4:", refundError.message);
            }

            await supabase
                .from('orders')
                .update({ status: 'cancelled' })
                .eq('activation_id', actId)
                .eq('status', 'processing_cancel'); 

            // 🔥 UBAH UI: Format teks sama persis dengan foto dan ada tombol Order Ulang
            const msgCancel =
`❌ *Order Dibatalkan*

📦 Layanan : ${esc(ord.service_name)}
📱 Nomor : \`${esc(ord.phone_number)}\`

💰 Refund : ${esc(formatRp(refundAmount))}
💳 Saldo telah dikembalikan ke akun Anda`;

            return ctx.editMessageText(msgCancel, {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Order Ulang', callback_data: 'server_wa_luar' }],
                        [{ text: '🔙 Menu Utama', callback_data: 'start' }]
                    ]
                }
            }).catch(()=>{});
        }

        // =========================
        // ❌ ERROR PROVIDER API
        // =========================
        // Rollback karena gagal batal di provider
        await supabase
            .from('orders')
            .update({ status: 'active' })
            .eq('activation_id', actId);

        const apiError = res.data?.error?.code;
        const apiMessage = res.data?.message;

        // 🔥 TAMBAHAN LOG UNTUK ADMIN
        console.log(`[WA LUAR REJECT] ID: ${actId} | Error: ${apiError} | Msg: ${apiMessage}`);

        if (apiError === "CANCEL_TOO_EARLY") {
            return ctx.answerCbQuery(`⚠️ ${apiMessage || "Terlalu cepat untuk batal."}`, { show_alert: true }).catch(()=>{});
        }

        return ctx.answerCbQuery(
            `⚠️ ${apiMessage || "Gagal membatalkan pesanan. Silakan coba lagi."}`,
            { show_alert: true }
        ).catch(()=>{});

    } catch (e) {
        console.error("Error Cancel S4:", e.message); 

        ctx.answerCbQuery(
            "❌ Terjadi kesalahan sistem.",
            { show_alert: true }
        ).catch(()=>{});
    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/resend_WaLuar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    // 🔒 ANTI DOUBLE CLICK
    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        // =========================
        // 1. VALIDASI DATA
        // =========================
        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) {
            return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        }

        if (order.status !== "active") {
            return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 2. API RESEND (TIMEOUT DITAMBAH & ERROR DITANGKAP)
        // =========================
        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/resend",
                { id: parseInt(actId) },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 15000 // 🔥 Naikkan jadi 15 detik
                }
            );
        } catch (err) {
            // 🔥 Tangkap pesan error ASLI dari API pusat
            const errorMsg = err.response?.data?.message || err.response?.data?.error?.message || "Koneksi pusat sibuk/Timeout. Coba lagi.";
            console.log(`❌ Error API Resend WA Luar [${actId}]:`, errorMsg);
            
            return ctx.answerCbQuery(`❌ Gagal: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        if (!res || !res.data || !res.data.success) {
            const errorMsg =
                res?.data?.error?.message ||
                res?.data?.message ||
                "Terjadi gangguan pada server pusat";

            return ctx.answerCbQuery(`⚠️ Gagal meminta SMS: ${errorMsg}`, { show_alert: true }).catch(()=>{});
        }

        // =========================
        // 3. SUCCESS - MATIKAN LOADING TOMBOL
        // =========================
        await ctx.answerCbQuery("✅ Berhasil meminta SMS baru...").catch(()=>{});

        // =========================
        // 4. HITUNG WAKTU & SALDO
        // =========================
        const startTime = new Date(order.created_at).getTime();

        const expiryTime = new Date(startTime + (20 * 60 * 1000))
            .toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZone: "Asia/Jakarta",
                hour12: false
            })
            .replace(/\./g, ":");

        const { data: user } = await supabase
            .from("users")
            .select("balance")
            .eq("id", userId)
            .maybeSingle();

        // =========================
        // 5. MESSAGE SUCCESS (MODIFIED UI)
        // =========================
        // Hapus kata WhatsApp agar rapi (konsisten dengan UI Polling)
        const displayCountry = order.service_name.replace(/^WhatsApp\s+/i, '');
        const oldOtpCode = order.sms_code ? esc(order.sms_code) : "\\-";

        // UI Diperbarui, bersih dari karakter minus / format aneh
        const msg =
`⏳ *MENUNGGU SMS WHATSAPP BARU*

📦 *Negara :* ${esc(displayCountry)}
📱 *Nomor :* \`${esc(order.phone_number)}\`
💰 *Harga :* ${esc(formatRp(order.price))}
💵 *Saldo :* ${esc(formatRp(user?.balance || 0))}

📩 *OTP LAMA :* \`${oldOtpCode}\`

📩 *OTP BARU :* Waiting For New OTP\\.\\.\\.

⏳ *Nokos Expired Pada :* ${esc(expiryTime)} WIB`;

        await ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
        }).catch(()=>{});

        // 🔥 CRITICAL FIX: HAPUS PEMANGGILAN `pollWaLuar` DI SINI!
        // Sama seperti sebelumnya, biarkan detektif asli di background yang menangkap kode barunya.

    } catch (e) {
        console.error("❌ RESEND WA LUAR ERROR:", e.message);

        try {
            await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{});
        } catch (err) {}

    } finally {
        activeTransactions.delete(userId);
    }
});

bot.action(/finish_WaLuar_(\d+)/, async (ctx) => {

    const actId = ctx.match[1];
    const userId = ctx.from.id;

    if (activeTransactions.has(userId)) {
        return ctx.answerCbQuery("⏳ Sedang diproses...", { show_alert: true }).catch(()=>{});
    }

    activeTransactions.add(userId);

    try {
        await checkUser(ctx);

        const { data: order } = await supabase
            .from("orders")
            .select("*")
            .eq("activation_id", actId)
            .eq("user_id", userId) 
            .maybeSingle();

        if (!order) return ctx.answerCbQuery("❌ Order tidak ditemukan.", { show_alert: true }).catch(()=>{});
        if (order.status !== "active") return ctx.answerCbQuery("❌ Order sudah tidak aktif.", { show_alert: true }).catch(()=>{});

        let latestOtp = "";

        try {
            const apiRes = await axios.get(
                `https://api.smscode.gg/v1/orders/${actId}`,
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}` }, timeout: 8000 }
            );

            if (apiRes.data.success) {
                latestOtp = apiRes.data.data?.otp_code || "";
            }
        } catch (err) {}

        let res;
        try {
            res = await axios.post(
                "https://api.smscode.gg/v1/orders/finish",
                { id: parseInt(actId) },
                { headers: { Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`, "Content-Type": "application/json" }, timeout: 8000 }
            );
        } catch (err) {
            return ctx.answerCbQuery("❌ Koneksi sibuk. Silakan KLIK ULANG tombol Selesai.", { show_alert: true }).catch(()=>{});
        }

        const result = res?.data;

        if (!result?.success && result?.data?.status !== "COMPLETED") {
            const errMsg = result?.error?.message || result?.message || "Status pesanan tidak valid";
            return ctx.answerCbQuery(`⚠️ Gagal menyelesaikan order: ${errMsg}`, { show_alert: true }).catch(()=>{});
        }

        await ctx.answerCbQuery("✅ Order WhatsApp Selesai!").catch(()=>{});

        if (latestOtp) {
            await supabase.from("orders").update({ sms_code: latestOtp }).eq("activation_id", actId);
        }

        await supabase.from("orders").update({ status: "completed" }).eq("activation_id", actId).eq("status", "active");

        // 🔥 UBAH UI: Format Sesuai Foto (Pakai WhatsApp Negara, Tanpa Tombol)
        const msg =
`✅ *ORDER SELESAI*

📦 Layanan: WhatsApp ${esc(order.service_name)}
📱 Nomor : \`${esc(order.phone_number)}\`
💰 Harga : Rp ${esc(order.price.toLocaleString('id-ID'))}

🙏 Terima kasih telah menggunakan layanan kami\\!`;

        return ctx.editMessageText(msg, {
            parse_mode: "MarkdownV2"
        }).catch(()=>{});

    } catch (e) {
        console.error("❌ ERROR FINISH S4:", e.message); 
        try { await ctx.answerCbQuery("❌ Terjadi kesalahan sistem. Silakan coba lagi.", { show_alert: true }).catch(()=>{}); } catch(err){}
    } finally {
        activeTransactions.delete(userId);
    }
});

bot.command("delwaluar", async (ctx) => {

    const userId = ctx.from.id.toString();
    const ADMIN_ID = process.env.ADMIN_ID;

    // =========================
    // CEK ADMIN
    // =========================
    if (userId !== ADMIN_ID) {
        return ctx.reply("❌ Kamu tidak memiliki akses.");
    }

    try {

        const args = ctx.message.text.split(" ");

        // =========================
        // VALIDASI INPUT
        // =========================
        if (args.length < 2) {
            return ctx.reply(
                "⚠️ Format salah\n\nGunakan:\n`/delwaluar <id>`",
                { parse_mode: 'Markdown' }
            );
        }

        const id = parseInt(args[1]);

        if (isNaN(id)) {
            return ctx.reply("❌ ID harus berupa angka.");
        }

        // =========================
        // CEK DATA
        // =========================
        const { data: service } = await supabase
            .from("wa_luar")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (!service) {
            return ctx.reply("❌ Layanan tidak ditemukan di tabel wa_luar.");
        }

        // =========================
        // HAPUS DATA
        // =========================
        await supabase
            .from("wa_luar")
            .delete()
            .eq("id", id);

        // 🔥 Reset Cache Server 4 agar menu langsung terupdate
        if (typeof cacheServices !== 'undefined' && cacheServices[4]) {
            cacheServices[4] = [];
            lastServiceUpdate[4] = 0;
        }

        // =========================
        // RESPONSE
        // =========================
        const msg =
`🗑️ *LAYANAN S4 BERHASIL DIHAPUS*

🆔 ID       : \`${id}\`
📦 Negara   : ${service.name}
💰 Harga    : ${formatRp(service.price)}`;

        ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (e) {

        console.log("ERROR DELETE WALUAR:", e.message);

        ctx.reply("❌ Gagal menghapus layanan.");
    }

});

bot.command("edithargawaluar", async (ctx) => {

    const userId = ctx.from.id.toString();
    const ADMIN_ID = process.env.ADMIN_ID;

    // =========================
    // CEK ADMIN
    // =========================
    if (userId !== ADMIN_ID) {
        return ctx.reply("❌ Kamu tidak memiliki akses.");
    }

    try {

        const args = ctx.message.text.split(" ");

        // =========================
        // VALIDASI INPUT
        // =========================
        if (args.length < 3) {
            return ctx.reply(
                "⚠️ Format salah\n\nGunakan:\n`/edithargawaluar <id> <harga_baru>`",
                { parse_mode: 'Markdown' }
            );
        }

        const id = parseInt(args[1]);
        const harga = parseInt(args[2]);

        if (isNaN(id) || isNaN(harga)) {
            return ctx.reply("❌ ID dan harga harus berupa angka.");
        }

        // =========================
        // CEK DATA
        // =========================
        const { data: service } = await supabase
            .from("wa_luar") // 🔥 Target tabel S4
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (!service) {
            return ctx.reply("❌ Data tidak ditemukan di tabel wa_luar.");
        }

        // =========================
        // UPDATE HARGA
        // =========================
        await supabase
            .from("wa_luar") // 🔥 Target tabel S4
            .update({ price: harga })
            .eq("id", id);

        // 🔥 Reset Cache Server 4 agar menu langsung terupdate
        if (typeof cacheServices !== 'undefined' && cacheServices[4]) {
            cacheServices[4] = [];
            lastServiceUpdate[4] = 0;
        }

        // =========================
        // RESPONSE
        // =========================
        const msg =
`✅ *HARGA S4 BERHASIL DIUPDATE*

🆔 ID       : \`${id}\`
📦 Negara   : ${service.name}

🔴 Harga Lama : ${formatRp(service.price)}
🟢 Harga Baru : ${formatRp(harga)}`;

        ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (e) {

        console.log("ERROR EDIT HARGA WALUAR:", e.message);

        ctx.reply("❌ Gagal mengupdate harga.");
    }

});

bot.command("editprodidwaluar", async (ctx) => {

    const ADMIN_ID = process.env.ADMIN_ID;

    if (String(ctx.from.id) !== String(ADMIN_ID)) {
        return ctx.reply("❌ Tidak punya akses.");
    }

    const args = ctx.message.text.split(" ").slice(1);

    if (args.length < 2) {
        return ctx.reply(
            "❌ Format salah\n\nGunakan:\n`/editprodidwaluar <id> <prod_id_baru>`",
            { parse_mode: 'Markdown' }
        );
    }

    const localId = parseInt(args[0]);
    const newProdId = parseInt(args[1]);

    if (isNaN(localId) || isNaN(newProdId)) {
        return ctx.reply("❌ ID dan Prod ID harus berupa angka.");
    }

    try {

        // =========================
        // CEK DATA
        // =========================
        const { data: item } = await supabase
            .from("wa_luar") // 🔥 Target tabel S4
            .select("*")
            .eq("id", localId)
            .maybeSingle();

        if (!item) {
            return ctx.reply("❌ Data tidak ditemukan di tabel wa_luar.");
        }

        // =========================
        // UPDATE PROVIDER ID
        // =========================
        await supabase
            .from("wa_luar") // 🔥 Target tabel S4
            .update({ provider_id: newProdId })
            .eq("id", localId);

        // 🔥 Reset Cache Server 4
        if (typeof cacheServices !== 'undefined' && cacheServices[4]) {
            cacheServices[4] = [];
            lastServiceUpdate[4] = 0;
        }

        // =========================
        // RESPONSE
        // =========================
        const msg =
`✅ *PROD ID S4 BERHASIL DIUPDATE*

🆔 ID: \`${localId}\`
📦 Negara: ${item.name}
🔁 Prod ID Lama: \`${item.provider_id}\`
🆕 Prod ID Baru: \`${newProdId}\``;

        await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (e) {
        console.error("ERROR EDIT PROD ID WALUAR:", e.message);
        ctx.reply("❌ Terjadi kesalahan saat update.");
    }

});

async function generateListWaLuar(ctx, page = 0) {
    try {
        const { data: services, error } = await supabase
            .from('wa_luar') // 🔥 Target tabel S4
            .select('*')
            .order('id', { ascending: true });

        if (error || !services || services.length === 0) {
            const emptyMsg = "⚠️ *LIST WA LUAR S4*\n\nTidak ada layanan tersedia untuk server ini\\.";
            const emptyBtn = Markup.inlineKeyboard([[Markup.button.callback("⬅ Kembali", "admin_menu")]]);
            
            if (ctx.callbackQuery) return await ctx.editMessageText(emptyMsg, { parse_mode: 'MarkdownV2', ...emptyBtn });
            return await ctx.reply(emptyMsg, { parse_mode: 'MarkdownV2', ...emptyBtn });
        }

        const total = services.length;
        const perPage = 10;
        const totalPage = Math.max(1, Math.ceil(total / perPage));

        // 🔥 CLAMP PAGE
        if (isNaN(page) || page < 0) page = 0;
        if (page >= totalPage) page = totalPage - 1;

        const start = page * perPage;
        const end = start + perPage;
        const pageData = services.slice(start, end);
        const currentPage = page + 1;

        let text = `⚙️ *DASHBOARD ADMIN: LIST WA LUAR S4*\n`;
        text += `📄 *Halaman ${currentPage}/${totalPage}* ${esc(`(Total: ${total})`)}\n`;
        text += esc(`──────────────────`) + `\n\n`;

        pageData.forEach((s) => {
            const country = s.country_id?.toString() || '-';

            text += `🆔 *ID ${s.id}* — ${esc(s.name)}\n`;
            text += `💰 ${esc(formatRp(s.price))} 📟 *Prod ID:* \`${esc(s.provider_id?.toString() || '-')}\`\n`;
            text += `🌐 *Negara:* \`${esc(country)}\` ?? *Srv:* \`4\`\n\n`;
        });

        // 🔥 NAVIGATION ROW (Anti Tabrakan S3)
        const buttons = [];
        const navRow = [];

        if (page > 0) {
            navRow.push(
                Markup.button.callback("⬅ Prev", `adm_s4_p_${page - 1}`)
            );
        }

        navRow.push(
            Markup.button.callback(`${currentPage}/${totalPage}`, "ignore")
        );

        if (page < totalPage - 1) {
            navRow.push(
                Markup.button.callback("Next ➡", `adm_s4_p_${page + 1}`)
            );
        }

        if (navRow.length > 0) {
            buttons.push(navRow);
        }

        const extra = {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
        };

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, extra).catch((e) =>
                console.error("Edit Error S4:", e.message)
            );
        } else {
            await ctx.reply(text, extra).catch((e) =>
                console.error("Reply Error S4:", e.message)
            );
        }

    } catch (e) {
        console.error("Global Error ListWaLuar:", e);
    }
}

// --- Handler Callback Navigasi Admin S4 ---
bot.action(/^adm_s4_p_(\d+)$/, async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return ctx.answerCbQuery("❌ Akses Ditolak");
    const page = parseInt(ctx.match[1]) || 0;
    await ctx.answerCbQuery().catch(() => {});
    return generateListWaLuar(ctx, page);
});

// --- COMMAND ADMIN S4 ---
bot.command('listwaluar', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    return generateListWaLuar(ctx, 0);
});

bot.action(/^svc_page_(\d+)_(\d+)$/, async (ctx, next) => {
    const server = Number(ctx.match[1]);

    // 🔥 Tambahkan angka 4 di sini agar navigasi S4 aktif
    if (![1, 2, 3, 4].includes(server)) {
        return next(); 
    }

    const page = Number(ctx.match[2]) || 0;
    await ctx.answerCbQuery().catch(() => {});
    return generateServiceMenu(ctx, page, server);
});

bot.action('hist_depo', async (ctx) => {

    // 🔥 WAJIB: hilangkan loading tombol
    await ctx.answerCbQuery().catch(()=>{});

    try {

        // =========================
        // 🔥 SINGLE QUERY (SUPER RINGAN & CEPAT)
        // =========================
        // Hanya 1 kali panggil DB, dan HANYA ambil kolom yang dipakai!
        const { data: deposits, error } = await supabase
            .from('deposits')
            .select('status, amount, created_at, order_id')
            .eq('user_id', ctx.from.id)
            .order('created_at', { ascending: false }); // Langsung urutkan dari yang terbaru

        if (error) throw error;

        const allDepos = deposits || [];

        // =========================
        // HITUNG TOTAL & AMBIL 5 TERAKHIR
        // =========================
        let totalDeposit = 0;

        allDepos.forEach(d => {
            if (d.status === 'completed') {
                totalDeposit += Number(d.amount || 0);
            }
        });

        // Ambil 5 data paling atas (karena sudah diurutkan menurun dari DB)
        const last5Deposits = allDepos.slice(0, 5);

        let msg =
`💰 *DEPOSIT HISTORY*
━━━━━━━━━━━━━━
💸 Total Deposit : *${esc(formatRp(totalDeposit))}*

💵 *5 Deposit Terakhir:*

`;

        if (last5Deposits.length > 0) {

            last5Deposits.forEach(d => {

                const e = (t) => t ? esc(t.toString()) : '\\-';

                let icon =
                    d.status === 'completed' ? '✅' :
                    d.status === 'cancelled' ? '❌' :
                    '⏳';

                const depoDate = new Date(d.created_at).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Jakarta'
                }).replace(/\./g, ':');

                msg +=
`${icon} *${e(formatRp(d.amount))}*
🧾 \`${e(d.order_id)}\`
📅 ${e(depoDate)} WIB

━━━━━━━━━━━━━━

`;

            });

        } else {

            msg += "Belum ada riwayat deposit\\.";

        }

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: 'start' }]
                ]
            }
        }).catch(()=>{}); // 🔥 anti crash

    } catch (err) {

        console.error("HIST DEPO ERROR:", err.message);

        ctx.answerCbQuery("Gagal memuat data.", {
            show_alert: true
        }).catch(()=>{});

    }
});

// --- 7. ADMIN PANEL ---
const isAdmin = (ctx) => String(ctx.from.id) === String(process.env.ADMIN_ID).trim();

bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply(
        `🛠 MENU ADMIN\n\n` +
        `/tambah_saldo <id> <jumlah>\n` +
        `/kurang_saldo <id> <jumlah>\n` +
        `/gen <nominal> <jumlah_kode>\n` +
        `/statistik\n` +
        `/cek_user <id>\n` +
        `/cek_stok\n` +
        `/cekdepo\n` +
        `/listsmscode\n` +
        `/addsmscode\n` +
        `/hargasmscode\n` +
        `/editprodid\n` +
        `/editharga_smscode\n` +
        `/delsmscode\n` +
        `/addwaluar\n` +
        `/hargasmscode2\n` +
        `/editlayanan3\n` +
        `/delwaluar\n` +
        `/edithargawaluar\n` +
        `/editprodidwaluar\n` +
        `/listwaluar\n` +
        `/listvak\n` +
        `/hargavak\n` +
        `/delvak\n` +
        `/editharga_vak\n` +
        `/add_service_vak\n` +
        `/setpromo\n` +
        `/maintdepo\n` +
        `/setharga\n` +
        `/cekpromo\n` +
        `/update\n` +
        `/delpromo\n` +
        `/edit_harga <id> <harga>\n` +
        `/edit_providerid <id> <providerid>\n` +
        `/edit_name <id> <name>\n` +
        `/cek_harga <code> <negara>\n` +
        `/add_service <code> <negara> <harga> <provider_id> <nama>\n` +
        `/del_service <id>\n` +
        `/list_service\n` +
        `/broadcast <pesan>\n` +
        `/ban <id>\n` +
        `/unban <id>`
    );
});

bot.command('setpromo', async (ctx) => {
    if (!isAdmin(ctx)) return; 
    const args = ctx.message.text.split(' ');
    
    if (args.length < 5) {
        return ctx.reply("❌ *Format Salah*\n`/setpromo <nama> <persen> <max_bonus> <min_depo>`\nContoh: `/setpromo MochiHoki 7 10000 10000`", { parse_mode: 'Markdown' });
    }

    const name = args[1];
    const percent = parseInt(args[2]);
    const maxB = parseInt(args[3]);
    const minD = parseInt(args[4]);

    try {
        await supabase.from('promo_settings').update({ is_active: false }).eq('is_active', true);

        const { error } = await supabase.from('promo_settings').insert({
            promo_name: name,
            percentage: percent,
            max_bonus: maxB,
            min_deposit: minD,
            is_active: true
        });

        if (error) throw error; // Lempar error ke catch
        
        ctx.reply(`✅ *PROMO AKTIF: ${name}*\n\nBonus: ${percent}%\nMax: Rp ${maxB.toLocaleString()}\nMin Depo: Rp ${minD.toLocaleString()}\n\n_Promo lainnya telah dinonaktifkan otomatis._`, { parse_mode: 'Markdown' });
        
    } catch (e) {
        // 🔥 INI PERBAIKANNYA: Log error ke terminal & kirim ke Telegram admin
        console.error("❌ ERROR SETPROMO:", e);
        ctx.reply(`❌ Gagal mengatur promo.\n\n*Alasan DB:* \`${e.message}\``, { parse_mode: 'Markdown' });
    }
});

// --- 1. COMMAND BROADCAST (FULL UPDATED) ---
bot.command('broadcast', async (ctx) => {

    // cek admin
    if (ctx.from.id !== 5351111807) return;

    const reply = ctx.message.reply_to_message;

    if (!reply || !reply.text) {
        return ctx.reply("❌ Reply pesan teks yang ingin dibroadcast.");
    }

    const rawMessage = reply.text;

    try {

        let allUsers = [];
        let from = 0;
        let to = 999;
        let finished = false;

        // pagination ambil semua user
        while (!finished) {

            const { data: users, error } = await supabase
                .from('users')
                .select('id')
                .range(from, to);

            if (error) {
                console.log("Fetch Error:", error);
                break;
            }

            if (users && users.length > 0) {

                allUsers = allUsers.concat(users);

                if (users.length < 1000) {
                    finished = true;
                } else {
                    from += 1000;
                    to += 1000;
                }

            } else {
                finished = true;
            }
        }

        if (allUsers.length === 0) {
            return ctx.reply("❌ Tidak ada user ditemukan.");
        }

        await ctx.reply(`⏳ Broadcast dimulai ke ${allUsers.length} user (background)...`);

        runBackgroundBroadcast(ctx.chat.id, allUsers, rawMessage);

    } catch (err) {

        console.log("Broadcast Error:", err);
        ctx.reply("❌ Terjadi kesalahan saat broadcast.");

    }

});

// --- 2. FUNGSI BACKGROUND PROCESS ---
async function runBackgroundBroadcast(adminChatId, users, rawMessage) {

    let success = 0;
    let failed = 0;

    for (const user of users) {

        try {

            const broadcastMsg = `📢 BROADCAST MESSAGE\n\n${rawMessage}`;

            await bot.telegram.sendPhoto(
                user.id,
                "AgACAgUAAxkBAAECXg1pqIuTYvWm9s9PF-IBzOo7HxkXlQACRA1rG8cxSVUK2ZDSuzJMnwEAAwIAA3cAAzoE",
                {
                    caption: broadcastMsg
                }
            );

            success++;

        } catch (e) {

            failed++;

        }

        // delay anti flood
        await new Promise(r => setTimeout(r, 40));
    }

    const reportMsg =
        `✅ <b>Broadcast Selesai</b>\n\n` +
        `👥 Total User: ${users.length}\n` +
        `✅ Terkirim: ${success}\n` +
        `❌ Gagal: ${failed}`;

    await bot.telegram.sendMessage(adminChatId, reportMsg, { parse_mode: "HTML" });
}

// --- FEATURE EDIT PROVIDER ID --- //
bot.command('edit_providerid', async (ctx) => {
    // Keamanan Admin
    if (ctx.from.id !== Number(process.env.ADMIN_ID)) return; 

    const args = ctx.message.text.split(' ');
    const idLayanan = args[1]; 
    const providBaru = args[2];

    if (!idLayanan || !providBaru) {
        return ctx.reply("❌ Format salah. Gunakan: `/edit_providerid <id_layanan> <provid_baru>`", { parse_mode: 'Markdown' });
    }

    try {
        // Update target ke kolom 'provider_id' dan kembalikan datanya
        const { data, error } = await supabase
            .from('services')
            .update({ provider_id: providBaru }) 
            .eq('id', idLayanan)
            .select();

        if (error) throw error;

        if (data && data.length > 0) {
            // 🔥 Ambil nama layanan dari data yang berhasil di-update
            const serviceName = data[0].name || "Tidak diketahui";
            
            ctx.reply(
                `✅ *Update Provider ID Berhasil!*\n\n` +
                `📦 *Layanan:* ${serviceName}\n` +
                `🔹 *ID DB:* \`${idLayanan}\`\n` +
                `🔸 *Provid Baru:* \`${providBaru}\``, 
                { parse_mode: 'Markdown' }
            );
        } else {
            ctx.reply("❌ Gagal. ID Layanan tidak ditemukan di database.");
        }
    } catch (err) {
        console.error("Error edit_providerid:", err.message);
        ctx.reply("🚨 Terjadi kesalahan saat update database.");
    }
});

bot.command('cek_stok', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const loadingMsg = await ctx.reply("⏳ Sedang mengambil data stok layanan terdaftar...");

    try {
        const { data: services, error } = await supabase
            .from('services')
            .select('*')
            .eq('is_active', true)
            .order('id');

        if (error || !services || services.length === 0) {
            return ctx.reply("❌ Tidak ada layanan terdaftar di database.");
        }

        let msg = "📊 *STOK LAYANAN TERDAFTAR*\n\n";
        let count = 0;

        for (const s of services) {
            try {
                const url = `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getPricesV3&service=${s.code}&country=${s.country}`;
                const res = await axios.get(url);
                const data = res.data;

                let stockCount = 0;
                if (data && data[s.country] && data[s.country][s.code] && data[s.country][s.code][s.provider_id]) {
                    stockCount = data[s.country][s.code][s.provider_id].count;
                }

                // FIX: Semua karakter pemisah (| dan -) harus di-escape secara manual atau lewat esc()
                const line = `🆔 *ID ${esc(s.id)}* \\| ${esc(s.name)}\n` +
                             `📦 Stok: \`${esc(stockCount)}\` \\| Prov: \`${esc(s.provider_id)}\`\n` +
                             `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;

                if ((msg + line).length > 3500) {
                    await ctx.replyWithMarkdownV2(msg);
                    msg = "";
                }
                msg += line;
                count++;

                await new Promise(r => setTimeout(r, 200));
            } catch (err) {
                console.error(`Error stok ID ${s.id}:`, err.message);
            }
        }

        await bot.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

        if (msg) {
            await ctx.replyWithMarkdownV2(msg);
        } else {
            ctx.reply("❌ Gagal mendapatkan data stok\.");
        }

    } catch (e) {
        console.error("Cek Stok Error:", e);
        ctx.reply("❌ Terjadi kesalahan sistem saat mengecek stok\.");
    }
});

// --- FITUR EDIT NAME (FIX MARKDOWNV2) ---
bot.command('edit_name', async (ctx) => {
    const args = ctx.message.text.split(' ');
    
    // Validasi input: /edit_name <id> <nama_baru>
    if (args.length < 3) {
        return ctx.reply("❌ *Format salah\\.*\nGunakan: `/edit_name <id> <nama_baru>`", { 
            parse_mode: 'MarkdownV2' 
        });
    }

    const serviceId = args[1];
    const newName = args.slice(2).join(' ');

    try {
        // Proses update ke Supabase
        const { error } = await supabase
            .from('services')
            .update({ name: newName })
            .eq('id', serviceId);

        if (error) throw error;

        await ctx.reply(`✅ *Berhasil\\!*\nNama layanan ID \`${esc(serviceId)}\` telah diubah menjadi: *${esc(newName)}*`, { 
            parse_mode: 'MarkdownV2' 
        });

    } catch (err) {
        console.error("Edit Name Error:", err);
        ctx.reply("❌ *Gagal mengubah nama\\.*\nPastikan ID benar atau coba lagi nanti\\.", { 
            parse_mode: 'MarkdownV2' 
        });
    }
});

bot.command('edit_harga', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.split(' ');
    const serviceId = parseInt(args[1]);
    const newPrice = parseInt(args[2]);

    // =========================
    // VALIDASI INPUT
    // =========================
    if (args.length < 3 || isNaN(serviceId) || isNaN(newPrice)) {
        return ctx.reply(
            "❌ Format Salah!\n\nGunakan:\n/edit_harga <id> <harga_baru>\n\nContoh:\n/edit_harga 12 5000"
        );
    }

    try {

        // =========================
        // CEK LAYANAN
        // =========================
        const { data: service, error: checkError } = await supabase
            .from('services')
            .select('name, price')
            .eq('id', serviceId)
            .single();

        if (checkError || !service) {
            return ctx.reply(`❌ Layanan dengan ID ${serviceId} tidak ditemukan.`);
        }

        // =========================
        // UPDATE HARGA
        // =========================
        const { error: updateError } = await supabase
            .from('services')
            .update({ price: newPrice })
            .eq('id', serviceId);

        if (updateError) throw updateError;

        // =========================
        // RESET CACHE AGAR MENU UPDATE
        // =========================
        cacheServices = {
            1: [],
            2: []
        };

        // =========================
        // PESAN SUKSES
        // =========================
        const msg =
        `✅ *HARGA BERHASIL DIUBAH*\n\n` +
        `📦 *Layanan:* ${esc(service.name)}\n` +
        `🆔 *ID      :* \`${serviceId}\`\n` +
        `💰 *Harga Lama:* ${esc(formatRp(service.price))}\n` +
        `💵 *Harga Baru:* ${esc(formatRp(newPrice))}`;

        await ctx.reply(msg, { parse_mode: "MarkdownV2" });

    } catch (e) {

        console.error("Edit Harga Error:", e);

        ctx.reply("❌ Terjadi kesalahan saat memperbarui database.");

    }
});

bot.command('cek_harga', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply("Format: /cek_harga <code> <negara>");

    try {
        const url = `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getPricesV3&service=${args[1]}&country=${args[2]}`;
        const res = await axios.get(url);
        const data = res.data;

        if (data[args[2]] && data[args[2]][args[1]]) {
            const providers = data[args[2]][args[1]];
            let msg = `📊 HARGA ${args[1].toUpperCase()} (${args[2]})\n\n`;
            for (const [key, val] of Object.entries(providers)) {
                let row = `🆔 Prov ID: ${key}\n💰 Modal: ${val.price}\n📦 Stok: ${val.count}\n----------------\n`;
                if ((msg + row).length > 3500) { await ctx.reply(msg); msg = ""; }
                msg += row;
            }
            msg += `\nTips: Copy Prov ID dan gunakan di /add_service`;
            await ctx.reply(msg).catch(() => ctx.reply("Pesan terlalu panjang."));
        } else { ctx.reply("❌ Data tidak ditemukan."); }
    } catch (e) { ctx.reply("❌ Error API SMSBower."); }
});

// --- HANDLE MENU REFERRAL ---
bot.action('menu_referral', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        const userId = ctx.from.id;
        const botUsername = ctx.botInfo.username;
        const refLink = `https://t.me/${botUsername}?start=${userId}`;

        // 1. Ambil data bawahan (referral)
        const { data: refUsers, count, error: userErr } = await supabase
            .from('users')
            .select('id', { count: 'exact' })
            .eq('referred_by', userId);

        const totalInvited = userErr ? '0' : (count ? count.toString() : '0');
        let totalKomisi = 0;

        // 2. Hitung Total Pendapatan Referral
        if (refUsers && refUsers.length > 0) {
            const refUserIds = refUsers.map(u => u.id);
            
            // Tarik semua riwayat deposit bawahan yang 'completed'
            const { data: refDeposits } = await supabase
                .from('deposits')
                .select('user_id, amount')
                .in('user_id', refUserIds)
                .eq('status', 'completed')
                .order('created_at', { ascending: true }); // Urutkan dari yang paling lama

            if (refDeposits) {
                const seenUsers = new Set();
                // Hanya hitung deposit pertama dari masing-masing user
                for (const dep of refDeposits) {
                    if (!seenUsers.has(dep.user_id)) {
                        seenUsers.add(dep.user_id);
                        totalKomisi += Math.floor(dep.amount * 0.10); // Komisi 10%
                    }
                }
            }
        }

        const msg = `👥 *PROGRAM REFERRAL MOCHI*\n\n` +
                    `Dapatkan bonus saldo sebesar *10%* setiap kali teman yang kamu undang melakukan top\\-up pertamanya\\!\n\n` +
                    `📊 *Statistik Kamu :*\n` +
                    `*└ Total Diundang :* ${esc(totalInvited)} orang\n` +
                    `*└ Pendapatan :* ${esc(formatRp(totalKomisi))}\n` +
                    `*└ Komisi :* 10% dari Nominal Deposit\n\n` +
                    `🔗 *Link Referral Kamu :*\n` +
                    `\`${esc(refLink)}\` \n\n` +
                    `_Klik link di atas untuk menyalin, atau gunakan tombol di bawah untuk membagikan link\\._`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('📣 Bagikan Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Ayo gabung di Mochi Cell! Top-up otomatis dan dapatkan bonus saldo menarik.')}`)],
            [Markup.button.callback('🔙 Kembali ke Menu', 'start')]
        ]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...keyboard
        }).catch(() => {});

    } catch (e) {
        console.error("Referral Menu Error:", e);
    }
});

bot.command('redeem', async (ctx) => {
    const args = ctx.message.text.split(' ');
    
    if (args.length < 2) return ctx.reply("❌ Format: `/redeem <kode_voucher>`", { parse_mode: 'Markdown' });
    const inputCode = args[1].toUpperCase();
    const userId = ctx.from.id;

    try {
        // 1. Ambil data voucher untuk dicek awal
        const { data: voucher, error: vFetchError } = await supabase
            .from('vouchers')
            .select('*')
            .eq('code', inputCode)
            .maybeSingle();

        if (vFetchError || !voucher) return ctx.reply("❌ Kode voucher tidak ditemukan.");
        if (voucher.is_used) return ctx.reply("❌ Maaf, kode ini sudah pernah diklaim sebelumnya.");

        // 2. Cek apakah user sudah ambil di batch yang sama (Jika ada batch_id)
        if (voucher.batch_id) {
            const { data: alreadyClaimed } = await supabase
                .from('vouchers')
                .select('id')
                .eq('used_by', userId)
                .eq('batch_id', voucher.batch_id)
                .maybeSingle();

            if (alreadyClaimed) {
                return ctx.reply("⚠️ *JATAH HABIS*\n\nAnda sudah mengambil 1 voucher dari pembagian ini\\. Tunggu batch selanjutnya ya\\!", { parse_mode: 'MarkdownV2' });
            }
        }

        // ==========================================
        // 🔥 KUNCI KEAMANAN 1: ANTI DOUBLE CLAIM (RACE CONDITION)
        // ==========================================
        // Kita paksa update HANYA JIKA is_used masih false di database.
        // Jika ada 2 orang barengan, orang kedua akan gagal di titik ini.
        const { data: claimedVoucher, error: vUpdateError } = await supabase
            .from('vouchers')
            .update({ 
                is_used: true, 
                used_by: userId,
                used_at: new Date().toISOString()
            })
            .eq('id', voucher.id)
            .eq('is_used', false) // Syarat mutlak!
            .select()
            .maybeSingle();

        if (vUpdateError || !claimedVoucher) {
            // Jika dikembalikan kosong/error, berarti ada orang lain yang lebih cepat 0.1 detik
            return ctx.reply("❌ Telat boss! Kode ini baru saja diklaim oleh orang lain.");
        }

        // ==========================================
        // 🔥 KUNCI KEAMANAN 2: AMAN DARI SALDO BENTROK
        // ==========================================
        // Gunakan RPC increment_balance agar saldo tidak nyangkut/overwrite
        const { error: balanceError } = await supabase.rpc('increment_balance', { 
            user_id: userId, 
            amount: voucher.amount 
        });

        if (balanceError) {
            console.error("Gagal tambah saldo redeem:", balanceError.message);
            return ctx.reply("⚠️ Voucher berhasil diklaim, tapi terjadi keterlambatan update saldo. Hubungi admin.");
        }

        // 4. Ambil saldo terbaru untuk ditampilkan di struk
        const { data: user } = await supabase.from('users').select('balance').eq('id', userId).maybeSingle();
        const finalBalance = user ? user.balance : 0;

        // 5. Pesan Sukses
        const amountMsg = `+Rp ${voucher.amount.toLocaleString('id-ID')}`;
        const balanceMsg = `Rp ${finalBalance.toLocaleString('id-ID')}`;

        ctx.reply(
            `✅ *REDEEM BERHASIL*\n\n` +
            `Saldo ${esc(amountMsg)} telah ditambahkan\\!\n` +
            `💵 Saldo sekarang: *${esc(balanceMsg)}*`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (e) {
        console.error("[REDEEM ERROR]", e.message);
        ctx.reply(`❌ Terjadi kesalahan sistem.`, { parse_mode: 'MarkdownV2' });
    }
});

const generateRandomCode = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

bot.command('checkin', async (ctx) => {
    const userId = ctx.from.id;
    
    // 🔥 PERBAIKAN: Hasil didapat secara acak dari 50 sampai 250
    const rewardAmount = Math.floor(Math.random() * (250 - 50 + 1)) + 50;

    // 🔒 Anti spam memory (cepat & ringan)
    if (userStates.get(userId) === 'CHECKIN_PROCESS') return;
    userStates.set(userId, 'CHECKIN_PROCESS');

    try {
        // 🔥 PERBAIKAN 1: Wajib daftarkan user dulu kalau dia belum ada di DB!
        const userExists = await checkUser(ctx);
        if (!userExists) return; // Hentikan kalau gagal daftar

        const now = new Date();

        // 🔍 Ambil checkin terakhir
        const { data: lastCheckin } = await supabase
            .from('checkins')
            .select('last_checkin')
            .eq('user_id', userId)
            .order('last_checkin', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastCheckin) {
            const lastDate = new Date(lastCheckin.last_checkin);
            const diffMs = now - lastDate;

            if (diffMs < 24 * 60 * 60 * 1000) {
                const msRemaining = (24 * 60 * 60 * 1000) - diffMs;
                const h = Math.floor(msRemaining / 3600000);
                const m = Math.floor((msRemaining % 3600000) / 60000);
                const s = Math.floor((msRemaining % 60000) / 1000);

                const prevTime = lastDate.toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZone: 'Asia/Jakarta'
                }).replace(/\./g, ':');

                return ctx.reply(
                    `⚠️ *SUDAH CHECKIN HARI INI*\n\n` +
                    `Anda sudah checkin pada pukul ${esc(prevTime)} WIB\\.\n` +
                    `⏳ *${h} jam ${m} menit ${s} detik*`,
                    { parse_mode: 'MarkdownV2' }
                );
            }
        }

        // =========================
        // 🔥 INSERT (TERPROTEKSI DB UNIQUE)
        // =========================
        const { error: insertErr } = await supabase
            .from('checkins')
            .insert({
                user_id: userId,
                amount: rewardAmount, // 🔥 Menyimpan nominal random ke DB
                last_checkin: now.toISOString()
            });

        if (insertErr) {
            if (insertErr.message.includes('duplicate')) {
                return ctx.reply("⚠️ Kamu sudah checkin hari ini.");
            }
            console.log("INSERT ERROR:", insertErr);
            return ctx.reply("❌ Gagal checkin, coba lagi.");
        }

        // =========================
        // 💰 UPDATE SALDO (AMAN)
        // =========================
        const { error: balErr } = await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: rewardAmount // 🔥 Menambahkan nominal random ke saldo
        });

        if (balErr) {
            console.log("BALANCE ERROR:", balErr.message);
        }

        // =========================
        // 🔥 PERBAIKAN 2: AMBIL SALDO DENGAN AMAN
        // =========================
        const { data: user } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .maybeSingle();

        // Fallback aman jika saldo bernilai undefined/null
        const currentBalance = user?.balance || 0;

        return ctx.reply(
            `✅ *CHECKIN BERHASIL*\n\n` +
            `Selamat\\! Kamu mendapatkan saldo gratis sebesar *Rp ${rewardAmount}*\\.\n` +
            `💵 Saldo sekarang: *Rp ${esc(currentBalance.toLocaleString('id-ID'))}*`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (e) {
        console.error("[CHECKIN ERROR]", e);
        ctx.reply("❌ Terjadi kesalahan sistem saat checkin.");
    } finally {
        // 🔓 selalu release lock
        userStates.delete(userId);
    }
});

bot.command('gen', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply("❌ Format: `/gen <nominal> <jumlah>`", { parse_mode: 'Markdown' });
    }

    const amount = parseInt(args[1]);
    const count = parseInt(args[2]);

    const batchId = `BATCH-${Date.now()}`;

    let insertData = [];
    let displayCodes = [];

    for (let i = 0; i < count; i++) {

        const code = `MOCHI-${generateRandomCode()}`;

        displayCodes.push(`\`${code}\``);

        insertData.push({
            code: code,
            amount: amount,
            batch_id: batchId,
            is_used: false
        });

    }

    await supabase.from('vouchers').insert(insertData);

    const text =
`🎟 *CODE REDEEM MOCHI*

✅ *${count} Code Redeem Berhasil Dibuat*

${displayCodes.join('\n')}

Gunakan dengan perintah:
\`/redeem <kode>\`

Contoh:
\`/redeem MOCHI-XXXXXXX\`

⚠️ Setiap user hanya bisa klaim *1 kode* dari batch ini.`;

    ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.command('add_service', async (ctx) => {

    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.trim().split(/\s+/);

    // Format: /add_service server code negara harga provider_id nama
    if (args.length < 7) {

        return ctx.reply(
`❌ <b>Format Salah</b>

Gunakan:
/add_service server code negara harga provider_id nama

Contoh:
/add_service 1 sh 6 950 3197 Shopee`,
            { parse_mode: 'HTML' }
        );

    }

    let serverInput = args[1];
    const code = args[2];
    const country = parseInt(args[3]);
    const price = parseInt(args[4]);
    const provider_id = parseInt(args[5]);
    const name = args.slice(6).join(' ');

    // =========================
    // VALIDASI ANGKA
    // =========================
    if (isNaN(country) || isNaN(price) || isNaN(provider_id)) {

        return ctx.reply(
`❌ <b>Format Angka Salah</b>

Negara, harga, dan provider_id harus berupa angka.`,
            { parse_mode: "HTML" }
        );

    }

    // =========================
    // KONVERSI SERVER
    // =========================
    let server;

    if (serverInput === "server1") server = 1;
    else if (serverInput === "server2") server = 2;
    else server = parseInt(serverInput);

    if (![1,2].includes(server)) {

        return ctx.reply(
`❌ <b>Server tidak valid</b>

Gunakan server <b>1</b> atau <b>2</b>.`,
            { parse_mode: "HTML" }
        );

    }

    try {

        const { error } = await supabase
        .from('services')
        .insert({
            server: server,
            code: code,
            country: country,
            price: price,
            provider_id: provider_id,
            name: name,
            is_active: true
        });

        if (error) {

            console.log("SUPABASE ERROR:", error);

            return ctx.reply(
`❌ <b>Database Error</b>

${error.message}`,
                { parse_mode: "HTML" }
            );

        }

        // =========================
        // RESET CACHE
        // =========================
        cacheServices = {1:[],2:[]};

        // =========================
        // TAMPILAN SUKSES
        // =========================
        const msg =
`✅ <b>LAYANAN BERHASIL DITAMBAHKAN</b>

🌐 Server : Server ${server}
📦 Nama   : ${name}
🔑 Code   : ${code}
🌍 Negara : ${country}
💰 Harga  : ${formatRp(price)}
🆔 Provider ID : ${provider_id}
🟢 Status : Aktif`;

        await ctx.reply(msg, { parse_mode: "HTML" })
        .catch(err => console.log("TELEGRAM ERROR:", err));

    } catch (err) {

        console.log("SYSTEM ERROR:", err);

        await ctx.reply(
`❌ <b>Terjadi kesalahan sistem.</b>`,
            { parse_mode: "HTML" }
        );

    }

});

// --- FITUR MAINTENANCE DEPOSIT ---
bot.command('maintdepo', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply("Gunakan: `/maintdepo on` atau `/maintdepo off`", { parse_mode: 'Markdown' });

    const status = args[1].toLowerCase() === 'on';
    
    const { error } = await supabase
        .from('system_settings')
        .update({ is_active: status })
        .eq('setting_key', 'maintenance_deposit');

    if (error) return ctx.reply("❌ Gagal merubah status maintenance.");
    
    ctx.reply(`🛠️ *Maintenance Deposit:* ${status ? '🔴 AKTIF (Deposit Ditutup)' : '?? NONAKTIF (Deposit Dibuka)'}`, { parse_mode: 'Markdown' });
});

// ================================
// FUNCTION PAGINATION ADMIN
// ================================
// 1. Fungsi Helper untuk membersihkan teks dari karakter berbahaya
const escapeHTML = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

async function showAdminServerPage(ctx, server, page = 0) {
    try {
        // 1. Ubah perPage menjadi 20
        const perPage = 20; 
        const start = page * perPage;
        const end = start + perPage - 1;

        // Ambil data dengan range 20 baris dan hitung total data (90+)
        const { data, error, count } = await supabase
            .from('services')
            .select('id,name,price,provider_id,is_active', { count: 'exact' })
            .eq('server', server.toString())
            .eq('is_active', true)
            .order('id', { ascending: true })
            .range(start, end);

        if (error) throw error;

        const totalData = count || 0;
        const totalPages = Math.ceil(totalData / perPage);

        // Debug log di Termius untuk memantau kapasitas halaman
        console.log(`📊 Server ${server} | Per Page: ${perPage} | Total DB: ${totalData} | Page: ${page + 1}/${totalPages}`);

        if (!data || data.length === 0) {
            return ctx.editMessageText("⚠️ Tidak ada data di halaman ini.");
        }

        // 2. Susun pesan menggunakan format HTML
        let text = `<b>⚙️ DASHBOARD ADMIN: SERVER ${server}</b>\n`;
        text += `📄 Halaman ${page + 1}/${totalPages} (Total: ${totalData})\n`;
        text += `━━━━━━━━━━━━━━━\n\n`;

        data.forEach((s) => {
            const safeName = escapeHTML(s.name);
            const safeProvider = escapeHTML(s.provider_id);

            text += `🆔 ID ${s.id} — ${safeName}\n`;
            text += `💰 ${formatRp(s.price)} ▪️ Prov: ${safeProvider}\n\n`;
        });

        const nav = [];
        if (page > 0) {
            nav.push(Markup.button.callback('⬅️ Prev', `admin_server_${server}_${page - 1}`));
        }
        
        nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));

        if (page + 1 < totalPages) {
            nav.push(Markup.button.callback('Next ➡️', `admin_server_${server}_${page + 1}`));
        }

        const keyboard = Markup.inlineKeyboard([
            nav, 
            [Markup.button.callback('⬅️ Kembali', 'admin_service_back')]
        ]);

        // 3. Kirim dengan parse_mode HTML agar aman dari karakter khusus
        await ctx.editMessageText(text, { 
            parse_mode: "HTML", 
            ...keyboard 
        }).catch((e) => console.log("Gagal update halaman:", e.message));

    } catch (err) {
        console.log("ERR:", err);
        ctx.reply("❌ Terjadi kesalahan saat memuat daftar layanan.");
    }
}

bot.action('admin_server_1', async (ctx) => {

    await ctx.answerCbQuery();

    await showAdminServerPage(ctx, 1, 0);

});

bot.action('admin_server_2', async (ctx) => {

    await ctx.answerCbQuery();

    await showAdminServerPage(ctx, 2, 0);

});

// Gunakan ^ untuk awal dan $ untuk akhir agar pencocokan data callback eksak
bot.action(/^admin_server_(\d+)_(\d+)$/, async (ctx) => {
    try {
        // Penting: Selalu answerCbQuery agar icon loading di Telegram hilang
        await ctx.answerCbQuery().catch(() => {}); 

        // Mengambil ID Server dan nomor halaman dari regex match
        const server = ctx.match[1]; 
        const page = parseInt(ctx.match[2]);

        // Debugging di konsol untuk memastikan data yang diterima benar
        console.log(`📡 Navigasi Admin | Server: ${server} | Ke Halaman Index: ${page}`);

        // Jalankan fungsi tampilkan halaman
        await showAdminServerPage(ctx, server, page);
    } catch (error) {
        console.error("ERR CALLBACK NAVIGASI:", error);
        await ctx.reply("❌ Gagal berpindah halaman.");
    }
});


bot.action('admin_service_back', async (ctx) => {

    const text =
`📦 *DAFTAR LAYANAN ADMIN*

Silakan pilih server untuk melihat daftar layanan.`;

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [
                Markup.button.callback('🚀 Server 1', 'admin_server_1'),
                Markup.button.callback('💎 Server 2', 'admin_server_2')
            ]
        ])
    }).catch(()=>{});

});

bot.command('list_service', async (ctx) => {

    const text =
`📦 *DAFTAR LAYANAN ADMIN*

Silakan pilih server untuk melihat daftar layanan.`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [
                Markup.button.callback('🚀 Server 1', 'admin_server_1'),
                Markup.button.callback('💎 Server 2', 'admin_server_2')
            ]
        ])
    });

});

// HANDLER KHUSUS ADMIN
bot.action(/^adm_svc_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery("Akses Ditolak");
    
    const pageIndex = parseInt(ctx.match[1]);
    const { data } = await supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .order('id', { ascending: true });

    if (!data) return ctx.answerCbQuery("Data Kosong");
    
    await sendAdminServicePage(ctx, data, pageIndex);
    return ctx.answerCbQuery();
});

bot.command('del_service', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const args = ctx.message.text.split(' ');
    const serviceId = args[1];

    if (!serviceId) {
        return ctx.reply("❌ *ID Tidak Ditemukan*\nGunakan: `/del_service <id_layanan>`", { 
            parse_mode: 'MarkdownV2' 
        });
    }

    try {
        // 1. Cek dulu apakah layanannya ada
        const { data: service } = await supabase
            .from('services')
            .select('name, country')
            .eq('id', serviceId)
            .maybeSingle();

        if (!service) {
            return ctx.reply("❓ *Gagal:* ID Layanan tidak terdaftar di database\\.", { 
                parse_mode: 'MarkdownV2' 
            });
        }

        // 2. Update status menjadi tidak aktif (Soft Delete)
        const { error } = await supabase
            .from('services')
            .update({ is_active: false })
            .eq('id', serviceId);

        if (error) throw error;

        // 3. Respon cantik dengan nama layanan yang dihapus
        let msg = `✅ *LAYANAN DINONAKTIFKAN*\n\n` +
                  `▫️ *ID:* \`${esc(serviceId)}\`\n` +
                  `▫️ *Nama:* ${esc(service.name)}\n` +
                  `▫️ *Negara:* ${esc(service.country)}\n\n` +
                  `_Layanan ini tidak akan muncul lagi di menu user\\._`;

        ctx.reply(msg, { parse_mode: 'MarkdownV2' });

    } catch (err) {
        console.error("Delete Error:", err);
        ctx.reply("❌ *Error:* Gagal menghapus layanan\\.", { parse_mode: 'MarkdownV2' });
    }
});

bot.command('tambah_saldo', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    const targetId = args[1];
    const nominal = parseInt(args[2]);

    if (!targetId || !nominal) return ctx.reply("Format salah! Gunakan: /tambah_saldo [ID] [Nominal]");

    const { data: user } = await supabase.from('users').select('balance').eq('id', targetId).single();
    
    if (user) {
        const newBalance = (user.balance || 0) + nominal;
        await supabase.from('users').update({ balance: newBalance }).eq('id', targetId);
        
        // --- NOTIFIKASI KE USER ---
        const notifMsg = `🔔 *SALDO DITAMBAHKAN*\n\n` +
                         `Halo, Admin telah menambahkan saldo ke akunmu\\.\n` +
                         `💰 Nominal: *${esc(formatRp(nominal))}*\n` +
                         `💳 Saldo Sekarang: *${esc(formatRp(newBalance))}*\n\n` +
                         `_Terima kasih telah menggunakan layanan kami\\!_`;
        
        bot.telegram.sendMessage(targetId, notifMsg, { parse_mode: 'MarkdownV2' }).catch(() => {});
        // --------------------------

        ctx.reply(`✅ Saldo User ${targetId} berhasil ditambah ${formatRp(nominal)}.`);
    } else {
        ctx.reply("❌ User tidak ditemukan di database.");
    }
});
/// SMSCODE. GG ///
bot.command('addsmscode', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
        return ctx.reply("⚠️ Format: `/addsmscode <prod_id> <harga> <nama>`", { parse_mode: 'Markdown' });
    }

    const productId = parseInt(args[1]);
    const price = parseInt(args[2]);
    const name = args.slice(3).join(' ');

    try {
        const { error } = await supabase
            .from('services_smscode')
            .insert([{ 
                provider_id: productId, 
                name: name, 
                price: price, 
                country_id: 7, 
                server: 3, 
                is_active: true 
            }]);

        if (error) throw error;

        // Reset Cache
        if (typeof cacheServices !== 'undefined') {
            cacheServices[3] = [];
            lastServiceUpdate[3] = 0;
        }

        // KUNCINYA DI SINI: Gunakan fungsi esc() untuk nama layanan
        const text = `✅ *BERHASIL TAMBAH LAYANAN S3*\n\n` +
                     `📦 Layanan : *${esc(name)}*\n` +
                     `🆔 Prod ID : \`${productId}\`\n` +
                     `💰 Harga   : *${esc(formatRp(price))}*\n` +
                     `🇮🇩 Negara  : Indonesia \\(ID: 7\\)`;

        await ctx.reply(text, { parse_mode: 'MarkdownV2' });

    } catch (e) {
        ctx.reply("❌ Gagal: " + e.message);
    }
});

async function generateListSmscode(ctx, page = 0) {
    try {
        const { data: services, error } = await supabase
            .from('services_smscode')
            .select('*')
            .order('id', { ascending: true });

        if (error || !services || services.length === 0) {
            const emptyMsg = "⚠️ *LIST SMSCODE*\n\nTidak ada layanan tersedia untuk server ini\\.";
            const emptyBtn = Markup.inlineKeyboard([[Markup.button.callback("⬅ Kembali", "admin_menu")]]);
            
            if (ctx.callbackQuery) return await ctx.editMessageText(emptyMsg, { parse_mode: 'MarkdownV2', ...emptyBtn });
            return await ctx.reply(emptyMsg, { parse_mode: 'MarkdownV2', ...emptyBtn });
        }

        const total = services.length;
        const perPage = 10;
        const totalPage = Math.max(1, Math.ceil(total / perPage));

        // 🔥 CLAMP PAGE
        if (isNaN(page) || page < 0) page = 0;
        if (page >= totalPage) page = totalPage - 1;

        const start = page * perPage;
        const end = start + perPage;
        const pageData = services.slice(start, end);
        const currentPage = page + 1;

        let text = `⚙️ *DASHBOARD ADMIN: LIST SMSCODE*\n`;
        text += `📄 *Halaman ${currentPage}/${totalPage}* ${esc(`(Total: ${total})`)}\n`;
        text += esc(`──────────────────`) + `\n\n`;

        pageData.forEach((s) => {
            const country = s.country_id === 7 ? 'id' : (s.country_id?.toString() || '-');

            text += `🆔 *ID ${s.id}* — ${esc(s.name)}\n`;
            text += `💰 ${esc(formatRp(s.price))} 📟 *Prod ID:* \`${esc(s.provider_id?.toString() || '-')}\`\n`;
            text += `🌐 *Negara:* \`${esc(country)}\` 🖥 *Srv:* \`3\`\n\n`;
        });

        // 🔥 NAVIGATION ROW
        const buttons = [];
        const navRow = [];

        if (page > 0) {
            navRow.push(
                Markup.button.callback("⬅ Prev", `adm_s3_p_${page - 1}`)
            );
        }

        navRow.push(
            Markup.button.callback(`${currentPage}/${totalPage}`, "ignore")
        );

        if (page < totalPage - 1) {
            navRow.push(
                Markup.button.callback("Next ➡", `adm_s3_p_${page + 1}`)
            );
        }

        if (navRow.length > 0) {
            buttons.push(navRow);
        }

        const extra = {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
        };

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, extra).catch((e) =>
                console.error("Edit Error S3:", e.message)
            );
        } else {
            await ctx.reply(text, extra).catch((e) =>
                console.error("Reply Error S3:", e.message)
            );
        }

    } catch (e) {
        console.error("Global Error ListSmscode:", e);
    }
}

// --- Handler Callback Navigasi Admin ---
bot.action(/^adm_s3_p_(\d+)$/, async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return ctx.answerCbQuery("❌ Akses Ditolak");
    const page = parseInt(ctx.match[1]) || 0;
    await ctx.answerCbQuery().catch(() => {});
    return generateListSmscode(ctx, page);
});

// --- COMMAND ADMIN ---
bot.command('listsmscode', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    return generateListSmscode(ctx, 0);
});

bot.action(/^svc_page_(\d+)_(\d+)$/, async (ctx, next) => {

    const server = Number(ctx.match[1]);

    // 🔥 BLOK kalau bukan user flow
    if (![1,2,3].includes(server)) {
        return next(); // lanjut ke handler lain
    }

    const page = Number(ctx.match[2]) || 0;

    await ctx.answerCbQuery().catch(()=>{});
    return generateServiceMenu(ctx, page, server);
});

bot.command('statistik', async (ctx) => {
    if (!isAdmin(ctx)) return;

    function esc(text) {
        return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }

    // 🔥 getAllData SUDAH DIHAPUS. Bot jadi 1000x lebih ringan!

    try {
        // --- PERBAIKAN TIMEZONE ---
        const now = new Date();
        const dateJkt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(now);

        const isoStart = `${dateJkt}T00:00:00+07:00`; 

        const pendingMsg = await ctx.reply("⏳ _Sedang menghitung statistik, mohon tunggu..._", { parse_mode: 'Markdown' });

        // ================================
        // 1. Deposit (Ambil total pakai RPC)
        // ================================
        const { data: depTotalData } = await supabase.rpc('get_total_stat', { 
            table_name: 'deposits', col_name: 'amount', iso_start: isoStart 
        });
        const totalDeposit = Number(depTotalData) || 0;

        // ================================
        // 2. Order Single
        // ================================
        const { data: ordTotalData } = await supabase.rpc('get_total_stat', { 
            table_name: 'orders', col_name: 'price', iso_start: isoStart 
        });
        const totalSingle = Number(ordTotalData) || 0;

        // Ambil jumlah count bawaan supabase (Sangat ringan)
        const { count: totalSingleCount } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('created_at', isoStart);

        // ================================
        // 3. Order Multi
        // ================================
        const { data: multiTotalData } = await supabase.rpc('get_total_stat', { 
            table_name: 'orders_multi', col_name: 'price_refund', iso_start: isoStart 
        });
        const totalMulti = Number(multiTotalData) || 0;

        const { count: totalMultiCount } = await supabase
            .from('orders_multi')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('created_at', isoStart);

        // ================================
        // 4. Total Penjualan
        // ================================
        const totalPenjualan = totalSingle + totalMulti;

        // ================================
        // 5. Saldo Vak-SMS
        // ================================
        let vakSmsBalance = "0";
        try {
            const resVak = await axios.get(
                `https://vak-sms.com/api/getBalance/?apiKey=${process.env.VAK_SMS_API_KEY}`
            );
            if (resVak.data && resVak.data.balance !== undefined) {
                vakSmsBalance = resVak.data.balance.toString();
            }
        } catch (err) {
            console.error("VakSMS Error:", err.message);
        }

        // ================================
        // 6. Saldo SMSBower
        // ================================
        let smsBowerBalance = "0";
        try {
            const resBower = await axios.get(
                `https://smsbower.page/stubs/handler_api.php?api_key=${process.env.SMSBOWER_API_KEY}&action=getBalance`
            );
            if (typeof resBower.data === "string" && resBower.data.includes('ACCESS_BALANCE')) {
                smsBowerBalance = resBower.data.split(':')[1];
            }
        } catch (err) {
            console.error("SMSBower Error:", err.message);
        }

        // ================================
        // 7. Saldo SMSCODE (IDR)
        // ================================
        let smscodeBalance = 0;
        try {
            const resSmscode = await axios.get(
                "https://api.smscode.gg/v1/balance",
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SMSCODE_API_KEY}`
                    }
                }
            );
            if (resSmscode.data?.success) {
                smscodeBalance = resSmscode.data.data?.balance || 0;
            }
        } catch (err) {
            console.error("SMSCODE Error:", err.message);
        }

        // ================================
        // 8. Format tanggal untuk pesan
        // ================================
        const dateStr = new Date().toLocaleDateString(
            'id-ID',
            { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' }
        );

        // ================================
        // 9. Pesan Statistik
        // ================================
        const msg =
`📊 *STATISTIK HARIAN MOCHI*
━━━━━━━━━━━━━━━━━━━━

📅 Tanggal : ${esc(dateStr)}

💰 Total Deposit : *${esc(formatRp(totalDeposit))}*

📦 Order Single : *${totalSingleCount || 0} trx*
📦 Order Multi  : *${totalMultiCount || 0} trx*

🛒 Total Penjualan : *${esc(formatRp(totalPenjualan))}*

🌐 *SALDO API PROVIDER*
💳 Vak\\-SMS : *${esc('$')}${esc(vakSmsBalance)}*
💳 SMSBower : *${esc('$')}${esc(smsBowerBalance)}*
💳 SMSCODE : *${esc(formatRp(smscodeBalance))}*`;

        // Hapus pesan "mohon tunggu" lalu kirim hasilnya
        await ctx.telegram.deleteMessage(ctx.chat.id, pendingMsg.message_id).catch(() => {});
        await ctx.reply(msg, { parse_mode: 'MarkdownV2' });

    } catch (e) {
        console.error("Statistik Error:", e);
        ctx.reply("❌ Terjadi kesalahan saat menghitung statistik.");
    }
});

bot.command('kurang_saldo', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    const targetId = args[1];
    const nominal = parseInt(args[2]);

    if (!targetId || isNaN(nominal)) return ctx.reply("Format salah! Gunakan: /kurang_saldo [ID] [Nominal]");

    const { data: user } = await supabase.from('users').select('balance').eq('id', targetId).single();
    
    if (user) {
        const newBalance = (user.balance || 0) - nominal;
        await supabase.from('users').update({ balance: newBalance }).eq('id', targetId);

        // --- NOTIFIKASI KE USER ---
        const notifMsg = `⚠️ *SALDO DIKURANGI*\n\n` +
                         `Halo, Admin telah melakukan penyesuaian \\(pengurangan\\) saldo pada akunmu\\.\n` +
                         `💰 Nominal: *${esc(formatRp(nominal))}*\n` +
                         `💳 Saldo Sekarang: *${esc(formatRp(newBalance))}*`;
        
        bot.telegram.sendMessage(targetId, notifMsg, { parse_mode: 'MarkdownV2' })
            .then(() => {
                // TEXT BALASAN YANG DIUBAH SESUAI REQUEST
                ctx.reply(`✅ Saldo ${targetId} user dikurangi sejumlah ${formatRp(nominal)}.`);
            })
            .catch((err) => {
                console.error(`Gagal kirim notif ke ${targetId}:`, err.message);
                ctx.reply(`✅ Saldo ${targetId} user dikurangi sejumlah ${formatRp(nominal)}, tapi notifikasi gagal terkirim.`);
            });
    } else {
        ctx.reply("❌ User tidak ditemukan di database.");
    }
});

bot.command('cek_user', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("Format salah! Gunakan: /cek_user [ID]");

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', targetId)
        .single();

    if (error || !data) {
        return ctx.reply("❌ User tidak ditemukan di database.");
    }

    // Susun format balasan: Username, ID, Saldo
    const username = data.username ? `@${data.username}` : "Tidak ada";
    const balance = formatRp(data.balance || 0);

    const msg = `👤 *Detail User :*\n` +
                `*└ Username :* ${esc(username)}\n` +
                `*└ ID :* \`${data.id}\`\n` +
                `*└ Saldo :* ${esc(balance)}`;

    ctx.reply(msg, { parse_mode: 'MarkdownV2' });
});

bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("Format: /ban [ID_USER]");

    try {
        // 1. Update status di database
        await supabase.from('users').update({ is_banned: true }).eq('id', targetId);
        
        // 2. Kirim pesan "perpisahan" ke user agar mereka tahu kenapa bot tidak merespon lagi
        bot.telegram.sendMessage(targetId, "⛔ Akun Anda telah DIBLOKIR oleh Admin. Akses layanan dihentikan.").catch(() => {});
        
        ctx.reply(`✅ User ${targetId} berhasil di-banned.`);
    } catch (err) {
        console.error("Error Ban:", err.message);
        ctx.reply("❌ Gagal memblokir user.");
    }
});

// --- TARUH INI DI ATAS SEMUA HANDLER TEKS LAIN ---
bot.command('setharga', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.split(' ');
    const tipe = args[1]?.toLowerCase();
    const hargaBaru = args[2];

    if (!tipe || !['grab', 'ovo'].includes(tipe) || !hargaBaru || isNaN(hargaBaru)) {
        return ctx.reply("❌ *Format Salah*\nGunakan: `/setharga ovo 1000`\\.", { parse_mode: 'MarkdownV2' });
    }

    try {
        await supabase.from('settings').upsert({ key: `harga_${tipe}_multi`, value: hargaBaru }, { onConflict: 'key' });

        const report = `✅ *HARGA UPDATE*\n\n` +
                       `📦 Layanan: *${esc(tipe.toUpperCase())}*\n` +
                       `💰 Harga Baru: *${esc(formatRp(hargaBaru))}*`;

        await ctx.reply(report, { parse_mode: 'MarkdownV2' });
    } catch (e) {
        ctx.reply("❌ Terjadi kesalahan sistem\\.", { parse_mode: 'MarkdownV2' });
    }
});

bot.command('cekdepo', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        // Escape titik pada pesan error
        return ctx.reply("❌ *Format Salah*\nContoh: `/cekdepo 12345678`\\.", { parse_mode: 'MarkdownV2' });
    }

    const targetUserId = args[1];

    try {
        const { data: history, error } = await supabase
            .from('deposits')
            .select('*')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!history || history.length === 0) {
            // Gunakan esc() untuk pesan jika data kosong agar titik (.) aman
            return ctx.reply(`🔴 ${esc(`Tidak ditemukan riwayat deposit untuk user ${targetUserId}.`)}`, { 
                parse_mode: 'MarkdownV2' 
            });
        }

        let report = `📊 *10 RIWAYAT DEPOSIT TERAKHIR*\n`;
        report += `👤 *User ID:* \`${esc(targetUserId)}\`\n\n`;

        history.forEach((depo, index) => {
            const statusIcon = depo.status === 'completed' ? '✅' : (depo.status === 'cancelled' ? '❌' : '⌛');
            
            // Perbaikan Krusial: Gunakan esc() untuk seluruh bagian bonus termasuk tanda '+'
            const bonusText = depo.bonus > 0 ? ` \\(${esc(`+${formatRp(depo.bonus)}`)}\\)` : '';
            
            // Escape index angka dan titik di belakangnya (misal 1.)
            report += `${index + 1}\\. ${statusIcon} *${esc(formatRp(depo.amount))}*${bonusText}\n`;
            report += `▫️ ID: \`${esc(depo.order_id)}\`\n`;
            report += `▫️ Status: ${esc(depo.status.toUpperCase())}\n`;
            
            const dateStr = new Date(depo.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            report += `▫️ Tgl: ${esc(dateStr)}\n`;
            report += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
        });

        ctx.reply(report, { parse_mode: 'MarkdownV2' });

    } catch (e) {
        console.error("CekDepo Error:", e.message);
        ctx.reply("❌ Terjadi kesalahan sistem\\.", { parse_mode: 'MarkdownV2' });
    }
});

bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.split(' ');
    const targetId = args[1];

    if (!targetId) {
        return ctx.reply("Format salah! Gunakan: /unban [ID_USER]");
    }

    try {
        const { error } = await supabase
            .from('users')
            .update({ is_banned: false })
            .eq('id', targetId);

        if (error) throw error;

        // Pesan konfirmasi yang menyertakan ID User
        ctx.reply(`✅ Akses User ${targetId} telah dipulihkan (Unbanned).`);
        
        // Memberitahu user bahwa mereka sudah bisa menggunakan bot kembali
        bot.telegram.sendMessage(targetId, "🔓 Akun Anda telah dipulihkan. Silahkan gunakan kembali layanan kami.").catch(() => {});

    } catch (err) {
        console.error("Error Unban:", err.message);
        ctx.reply("❌ Gagal membuka blokir pengguna. Pastikan ID benar.");
    }
});

// --- HANDLER EXPIRED DEPOSIT (FIX WIB) --- ///
async function handleExpiredDeposit(userId, messageId, orderId) {
    try {
        // Cek status di database
        const { data: deposit } = await supabase
            .from('deposits')
            .select('status, amount')
            .eq('order_id', orderId)
            .single();

        // Hanya kirim notifikasi jika status masih pending
        if (deposit && deposit.status === 'pending') {
            await supabase.from('deposits').update({ status: 'expired' }).eq('order_id', orderId);

            // Hapus pesan QRIS lama
            await bot.telegram.deleteMessage(userId, messageId).catch(() => {});

            // Ambil waktu sekarang untuk tampilan
            const now = new Date();
            
            // FIX: Tambahkan timeZone Asia/Jakarta agar tanggal & jam tetap WIB
            const dateStr = now.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric',
                timeZone: 'Asia/Jakarta' 
            });
            
            const timeStr = now.toLocaleTimeString('id-ID', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                timeZone: 'Asia/Jakarta' 
            }).replace(/\./g, ':');

            // Format pesan sesuai gambar
            const expiredMsg = 
                `⚠️ *Pembayaran Dibatalkan*\n\n` +
                `🧾 *ID Transaksi:* ${esc(orderId)}\n` + 
                `💰 *Nominal: ${esc(formatRp(deposit.amount))}*\n` + 
                `📅 *Status: Dibatalkan*\n\n` +
                `⏰ ${esc(dateStr)} • ${esc(timeStr)} WIB`;

            // Kirim pesan tanpa reply_markup
            await bot.telegram.sendMessage(userId, expiredMsg, {
                parse_mode: 'MarkdownV2'
            });
        }
    } catch (e) {
        console.error("Error handling expired deposit:", e);
    }
}

bot.command('add_service_vak', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const args = ctx.message.text.trim().split(/\s+/);

    // Format: /add_service_vak server code negara harga nama
    if (args.length < 6) {
        return ctx.reply(
            `<b>❌ Format Salah</b>\n\n` +
            `Gunakan:\n` +
            `<code>/add_service_vak server code negara harga nama</code>\n\n` +
            `Contoh:\n` +
            `<code>/add_service_vak 2 kpk id 850 Kopken</code>`,
            { parse_mode: 'HTML' }
        );
    }

    const server = args[1];
    const code = args[2].toLowerCase();
    const country = args[3].toLowerCase(); // Sekarang aman memasukkan "id", "ru", dll
    const price = parseInt(args[4]);
    const name = args.slice(5).join(' ');

    try {
        const { error } = await supabase
            .from('services_vak') // Mengarah ke tabel baru
            .insert({
                server: server,
                code: code,
                country: country,
                price: price,
                name: name,
                is_active: true
            });

        if (error) throw error;

        const msg =
            `✅ <b>LAYANAN VAK BERHASIL DITAMBAHKAN</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🌐 <b>Server</b>   : Server ${server}\n` +
            `📦 <b>Nama</b>     : ${escapeHTML(name)}\n` +
            `🔑 <b>Kode VAK</b> : <code>${code}</code>\n` +
            `🌍 <b>Negara</b>   : <code>${country.toUpperCase()}</code>\n` +
            `💰 <b>Harga</b>    : Rp ${price.toLocaleString('id-ID')}\n` +
            `🟢 <b>Status</b>   : Aktif`;

        await ctx.reply(msg, { parse_mode: "HTML" });

    } catch (err) {
        console.error("ERROR ADD VAK:", err);
        await ctx.reply(`❌ <b>Gagal Simpan:</b>\n${err.message}`, { parse_mode: "HTML" });
    }
});

bot.command("hargavak", async (ctx) => {
    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();

    if (!text) {
        return ctx.reply("❌ *Gunakan format:*\n`/hargavak kode_layanan`\n\nContoh: `/hargavak wa` atau `/hargavak ka`", { parse_mode: "Markdown" });
    }

    try {
        const res = await axios.get("https://vak-sms.com/stubs/handler_api.php", {
            params: {
                api_key: process.env.VAK_SMS_API_KEY,
                action: "getPrices"
                // Kita lepas filternya supaya bisa cari harga termurah di semua negara
            },
            timeout: 10000
        });

        let rawData = res.data;

        // Paksa jadi Object jika datangnya String
        if (typeof rawData === 'string') {
            try { rawData = JSON.parse(rawData); } catch (e) { 
                return ctx.reply("❌ Format data dari VAK tidak valid."); 
            }
        }

        const keyword = text.toLowerCase();
        let results = [];

        // Bongkar semua ID Negara (Angka) dari hasil API
        for (const [countryId, services] of Object.entries(rawData)) {
            for (const [serviceCode, info] of Object.entries(services)) {
                
                const code = serviceCode.toLowerCase();
                const harga = info.price || info.cost || info.Price || info.Cost || 0;
                const stok = info.count || info.Count || 0;

                // Filter berdasarkan keyword kode layanan
                if (code.includes(keyword)) {
                    results.push({
                        countryId: countryId, // Ini adalah ID Angka (misal: 6, 12, 143)
                        code: serviceCode,
                        price: parseFloat(harga),
                        stock: parseInt(stok)
                    });
                }
            }
        }

        if (results.length === 0) {
            return ctx.reply(`❌ Layanan *${text}* tidak ditemukan.\n\n💡 Coba kode singkat: \`wa\`, \`tg\`, \`ka\`, \`gl\`.`, { parse_mode: "Markdown" });
        }

        // Urutkan dari harga TERMURAH
        results.sort((a, b) => a.price - b.price);

        let msg = `📊 *HASIL CEK HARGA VAK: ${text.toUpperCase()}*\n_(Urut dari termurah)_\n\n`;

        // Ambil 15 hasil terbaik yang stoknya ada
        const filtered = results.filter(r => r.stock > 0).slice(0, 15);

        if (filtered.length === 0) {
            return ctx.reply(`⚠️ Layanan *${text}* ditemukan, tapi semua stok sedang KOSONG.`);
        }

        filtered.forEach(p => {
            msg += `🌍 *ID Negara: ${p.countryId}*\n🆔 Kode: \`${p.code}\`\n💰 Modal: $${p.price.toFixed(3)}\n📊 Stok: ${p.stock}\n\n`;
        });

        msg += `────────────────\n💡 *Note:* Masukkan angka ID Negara di atas ke database Supabase Anda\\.`;

        await ctx.reply(msg, { parse_mode: "Markdown" });

    } catch (e) {
        console.error("❌ [VAK ERROR]:", e.message);
        ctx.reply("❌ Terjadi kesalahan saat menghubungi server VAK.");
    }
});

// 2. FITUR CEK PROMO AKTIF
bot.command('cekpromo', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { data: activePromo } = await supabase
        .from('promo_settings')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();

    if (!activePromo) return ctx.reply("🔴 *Tidak ada promo yang sedang aktif.*", { parse_mode: 'Markdown' });

    ctx.reply(
        `🎫 *PROMO AKTIF SAAT INI*\n\n` +
        `ID: \`${activePromo.id}\`\n` +
        `Nama: *${activePromo.promo_name}*\n` +
        `Bonus: ${activePromo.percentage}%\n` +
        `Batas: Rp ${activePromo.max_bonus.toLocaleString()}\n` +
        `Minimal: Rp ${activePromo.min_deposit.toLocaleString()}\n\n` +
        `Untuk menghapus, ketik: \`/delpromo ${activePromo.id}\``, 
        { parse_mode: 'Markdown' }
    );
});

// 3. FITUR HAPUS PROMO
bot.command('delpromo', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply("❌ Gunakan: `/delpromo <id_promo>`");

    const promoId = args[1];
    const { error } = await supabase.from('promo_settings').delete().eq('id', promoId);

    if (error) return ctx.reply("❌ Gagal menghapus promo.");
    ctx.reply(`🗑️ Promo dengan ID \`${promoId}\` telah dihapus.`);
});

// --- 8. HANDLE DEPOSIT (FINAL: CANVAS + PROTEKSI STATE + MAINTENANCE) ---
bot.on('text', async (ctx) => {
    if (!ctx.message || !ctx.message.text) return;

    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Cek apakah user sedang dalam mode ketik nominal
    if (userStates.get(userId) !== 'WAITING_DEPOSIT') return;

    const amount = parseInt(text);
    if (isNaN(amount) || !/^\d+$/.test(text)) {
        return ctx.reply("❌ *Format Salah!*\nSilakan ketik angka saja tanpa titik atau koma. Contoh: `15000`", { parse_mode: "Markdown" });
    }

    try {
        // 🔥 LOCK (ANTI DOUBLE CLICK)
        userStates.set(userId, 'PROCESSING_DEPOSIT');

        const { data: maint } = await supabase.from('system_settings').select('*').eq('setting_key', 'maintenance_deposit').single();

        if (maint && maint.is_active) {
            userStates.delete(userId);
            return ctx.reply(`⚠️ *MAINTENANCE*\n\n${esc(maint.message)}`, { parse_mode: 'MarkdownV2' });
        }

        if (amount < 1000 || amount > 1000000) {
            const msg = amount < 1000 ? "Minimal deposit Rp 1.000" : "Maksimal deposit Rp 1.000.000";
            userStates.delete(userId);
            return ctx.reply(`❌ *Nominal Salah*\n${esc(msg)}`, { parse_mode: 'MarkdownV2' });
        }

        const loadingMsg = await ctx.reply("⏳ Sedang membuat QRIS...");

        // 🔥 LEPAS LOCK BIAR USER BEBAS
        userStates.delete(userId);

        // 🔥 BACKGROUND PROCESS (REAL ASYNC)
        setImmediate(() => {
            processQrisBackground(chatId, userId, amount, loadingMsg.message_id);
        });

    } catch (err) {
        console.error("Trigger Deposit Error:", err);
        userStates.delete(userId);
        ctx.reply("❌ Terjadi kesalahan sistem.").catch(() => {});
    }
});

async function processQrisBackground(chatId, userId, amount, loadingId) {
    try {
        // 1. Ambil Promo
        const { data: promo } = await supabase
            .from('promo_settings')
            .select('*')
            .eq('is_active', true)
            .maybeSingle();

        let bonus = 0;
        let promoName = "";
        let promoPercent = 0;

        if (promo && amount >= promo.min_deposit) {
            promoName = promo.promo_name;
            promoPercent = promo.percentage;
            bonus = Math.floor((amount * promoPercent) / 100);
            if (bonus > promo.max_bonus) bonus = promo.max_bonus;
        }

        const orderId = `MOCHI-${Math.random().toString(16).toUpperCase().slice(2, 10)}`;
        const expiryTime = new Date(Date.now() + 60 * 60000)
            .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })
            .replace(/\./g, ':');

        // 2. Request API Pakasir
        const res = await axios.post(`https://app.pakasir.com/api/transactioncreate/qris`, {
            project: process.env.PAKASIR_PROJECT_SLUG,
            order_id: orderId,
            amount: amount,
            api_key: process.env.PAKASIR_API_KEY
        });

        const payment = res.data.payment;
        const totalBayar = payment.total_payment;
        const saldoDiterima = amount + bonus;

        // 3. Canvas & QR Generation
        const canvas = createCanvas(1000, 1000);
        const canvasCtx = canvas.getContext('2d');
        try {
            const background = await loadImage(path.join(__dirname, 'assets', 'template_qris.png'));
            canvasCtx.drawImage(background, 0, 0, 1000, 1000);
        } catch (assetError) {
            canvasCtx.fillStyle = '#fffdf2';
            canvasCtx.fillRect(0, 0, 1000, 1000);
            canvasCtx.strokeStyle = '#000000';
            canvasCtx.lineWidth = 12;
            canvasCtx.strokeRect(40, 40, 920, 920);
            canvasCtx.fillStyle = '#000000';
            canvasCtx.font = 'bold 58px sans-serif';
            canvasCtx.textAlign = 'center';
            canvasCtx.fillText('MOCHI OTP', 500, 160);
            canvasCtx.font = '32px sans-serif';
            canvasCtx.fillText('Scan QRIS untuk top up saldo', 500, 220);
            console.warn('Template QRIS tidak ditemukan, memakai fallback canvas:', assetError.message);
        }

        const qrBuffer = await QRCode.toBuffer(payment.payment_number, {
            width: 505,
            margin: 1,
            color: { dark: '#3E2A78', light: '#00000000' }
        });

        const qrImage = await loadImage(qrBuffer);
        canvasCtx.drawImage(qrImage, (1000 - 505) / 2, 352, 505, 505);
        const finalBuffer = canvas.toBuffer();

        // 4. Hapus Pesan Loading
        await bot.telegram.deleteMessage(chatId, loadingId).catch(() => {});

        // 5. Kirim QRIS & Caption
        let caption = `✅ *DEPOSIT DIBUAT*\n\n📋 *Order ID :* \`${esc(orderId)}\`\n💰 *Total Bayar :* ${esc(formatRp(totalBayar))}\n\n💵 *Rincian Saldo Masuk :*\n▫️ Nominal: ${esc(formatRp(amount))}\n`;
        if (bonus > 0) {
            caption += `▫️ Promo: ${esc(promoName)} \\(${esc(promoPercent)}\\%\\)\n▫️ Bonus: ${esc(formatRp(bonus))}\n`;
        }
        caption += `▫️ *Total Diterima: ${esc(formatRp(saldoDiterima))}*\n\n⏳ *Status:* Menunggu Pembayaran\n📛 *Expired pada :* ${esc(expiryTime)} WIB`;

        const sentMsg = await bot.telegram.sendPhoto(chatId, { source: finalBuffer }, {
            caption,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [[{ text: '🛑 Batalkan Deposit', callback_data: `cancel_depo_${orderId}` }]]
            }
        });

        // 6. Simpan ke Database
        await supabase.from('deposits').insert({
            order_id: orderId,
            user_id: userId,
            amount,
            bonus,
            status: 'pending',
            message_id: sentMsg.message_id,
            payment_url: payment.payment_number
        });

        // 7. Auto Expired
        setTimeout(() => {
            handleExpiredDeposit(userId, sentMsg.message_id, orderId);
        }, 3600000);

    } catch (err) {
        console.error("Background Process Error:", err);
        bot.telegram.deleteMessage(chatId, loadingId).catch(() => {});
        bot.telegram.sendMessage(chatId, "❌ Gagal memproses QRIS\\. Silakan coba lagi nanti\\.", { parse_mode: 'MarkdownV2' });
    }
}

// --- HANDLE CANCEL DEPOSIT (CLEAN VERSION) ---
bot.action(/cancel_depo_(.+)/, async (ctx) => {

    const orderId = ctx.match[1];

    try {
        const { data: deposit } = await supabase
            .from('deposits')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();
        
        if (deposit && deposit.status === 'pending') {

            // 🔒 LOCK (ANTI DOUBLE CLICK)
            const { data: updated } = await supabase
                .from('deposits')
                .update({ status: 'cancelled' })
                .eq('order_id', orderId)
                .eq('status', 'pending')
                .select()
                .maybeSingle();

            if (!updated) {
                return ctx.answerCbQuery(
                    "⚠️ Sudah diproses sebelumnya.",
                    { show_alert: true }
                ).catch(()=>{});
            }

            // 🔥 HAPUS QRIS
            await ctx.deleteMessage().catch(() => {}); 
            
            // 🔥 NOTIF KECIL (opsional)
            ctx.answerCbQuery("✅ Deposit dibatalkan").catch(()=>{});

            // 🔥 KONFIRMASI DENGAN TOMBOL DEPOSIT ULANG
            return ctx.reply(
                `❌ *DEPOSIT DIBATALKAN*\n` +
                `Tagihan \`${esc(orderId)}\` telah berhasil dihapus\\.`, 
                { 
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Deposit Ulang", callback_data: "menu_deposit" }]
                        ]
                    }
                }
            ).catch(()=>{});
        } 
        
        // =========================
        // 🔥 JIKA SUDAH TIDAK AKTIF
        // =========================
        await ctx.deleteMessage().catch(() => {});

        return ctx.answerCbQuery(
            "⚠️ Deposit sudah tidak aktif.",
            { show_alert: true }
        ).catch(()=>{});

    } catch (e) {
        console.error("Cancel Depo Error:", e.message);

        await ctx.deleteMessage().catch(() => {});

        ctx.answerCbQuery(
            "❌ Terjadi kesalahan sistem.",
            { show_alert: true }
        ).catch(()=>{});
    }
});

bot.command('cek', async (ctx) => {
    const userId = ctx.from.id;
    
    // Ambil data deposit terakhir yang masih pending
    const { data: deposits } = await supabase
        .from('deposits')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

    if (!deposits || deposits.length === 0) {
        return ctx.reply("✅ Tidak ada tagihan pending.");
    }

    const pendingOrder = deposits[0];

    try {
        const res = await axios.get(`https://app.pakasir.com/api/transactiondetail?project=${process.env.PAKASIR_PROJECT_SLUG}&order_id=${pendingOrder.order_id}`);
        const trx = res.data.transaction;

        if (trx && trx.status === 'completed') {
            // 1. Update status deposit di DB
            await supabase.from('deposits').update({ status: 'completed' }).eq('order_id', pendingOrder.order_id);

            // 2. Ambil saldo user saat ini
            const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();

            // 3. HITUNG TOTAL: Nominal Pakasir + Bonus dari DB
            const bonus = pendingOrder.bonus || 0;
            const totalTambah = trx.amount + bonus;
            const newBalance = (user.balance || 0) + totalTambah;

            // 4. Update saldo di database
            await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
            
            // 5. Hapus pesan QRIS lama
            if (pendingOrder.message_id) {
                await bot.telegram.deleteMessage(userId, pendingOrder.message_id).catch(() => {});
            }

            // 6. Kirim pesan sukses lengkap dengan rincian bonus
            const successMsg = 
                `✅ *DEPOSIT BERHASIL\\!*\n\n` +
                `💰 Nominal: ${esc(formatRp(trx.amount))}\n` +
                `🎁 Bonus Promo: ${esc(formatRp(bonus))}\n` +
                `💵 Total Masuk: *${esc(formatRp(totalTambah))}*\n\n` +
                `💳 *Saldo Sekarang:* ${esc(formatRp(newBalance))}`;

            ctx.reply(successMsg, { parse_mode: 'MarkdownV2' });

        } else { 
            ctx.reply(`⚠️ Status: ${trx ? trx.status : 'Belum dibayar'}.`); 
        }
    } catch (err) { 
        console.error("Cek Error:", err);
        ctx.reply("❌ Gagal koneksi ke Pakasir atau terjadi kesalahan sistem."); 
    }
});

// =========================================
// ♻️ INTERNAL API: RESET CACHE DARI SCRIPT SYNC
// =========================================
app.get('/internal/clear-cache/:server', (req, res) => {
    const serverId = req.params.server;

    if (serverId === '3') {
        cacheServices[3] = [];
        lastServiceUpdate[3] = 0;
        console.log("♻️ Cache Server 3 sukses di-reset via Internal API!");
    } else if (serverId === '4') {
        cacheServices[4] = [];
        lastServiceUpdate[4] = 0;
        console.log("♻️ Cache WA Luar sukses di-reset via Internal API!");
    }

    res.send('CACHE CLEARED');
});

app.get('/ping', (req, res) => {
    return res.status(200).send('PONG');
});

app.post('/webhook/pakasir', async (req, res) => {
    try {
        const data = req.body;

        // Validasi webhook
        if (data.status !== 'completed' || data.project !== process.env.PAKASIR_PROJECT_SLUG) {
            return res.send('OK');
        }

        // =========================
        // 🔎 AMBIL DATA DEPOSIT (HARUS PENDING)
        // =========================
        const { data: deposit } = await supabase
            .from('deposits')
            .select('*')
            .eq('order_id', data.order_id)
            .eq('status', 'pending')
            .maybeSingle();

        if (!deposit) return res.send('OK');

        // =========================
        // 🔒 LOCK DEPOSIT (ANTI DOUBLE EXECUTION)
        // =========================
        const { data: updated } = await supabase
            .from('deposits')
            .update({ status: 'completed' })
            .eq('order_id', data.order_id)
            .eq('status', 'pending')
            .select()
            .maybeSingle();

        if (!updated) return res.send('OK');

        // =========================
        // 👤 AMBIL USER
        // =========================
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', deposit.user_id)
            .single();

        if (!user) {
            console.log("❌ USER TIDAK DITEMUKAN");
            return res.send('OK');
        }

        // =========================
        // 💰 HITUNG & UPDATE SALDO USER
        // =========================
        const amount = Number(deposit.amount) || 0;
        const bonusPromo = Number(deposit.bonus) || 0;
        const totalTambah = amount + bonusPromo;
        const newBalance = Number(user.balance || 0) + totalTambah;

        await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('id', deposit.user_id);

        // =========================
        // 🎁 REFERRAL (10% - HANYA TOP-UP PERTAMA)
        // =========================
        if (user.referred_by) {
            // Gunakan metode COUNT agar akurat dan tidak kena bug 'null'
            const { count, error: countError } = await supabase
                .from('deposits')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', deposit.user_id)
                .eq('status', 'completed');

            if (countError) {
                console.error("❌ ERROR CEK HISTORY:", countError.message);
            }

            // Karena data barusan diupdate jadi 'completed', jika ini pertama kali maka count PASTI 1.
            if (count === 1) {
                const bonusRef = Math.floor(amount * 0.10); // 10% dari nominal top-up
                
                const { data: referrer } = await supabase
                    .from('users')
                    .select('balance')
                    .eq('id', user.referred_by)
                    .single();

                if (referrer) {
                    const newRefBalance = Number(referrer.balance || 0) + bonusRef;

                    const { error: updateRefErr } = await supabase
                        .from('users')
                        .update({ balance: newRefBalance })
                        .eq('id', user.referred_by);

                    if (!updateRefErr) {
                        const refNotif = `💸 *KOMISI REFERRAL MASUK\\!*\n\nTeman kamu baru saja melakukan top\\-up pertamanya\\!\n💰 Bonus: *${esc(formatRp(bonusRef))}*\n💳 Saldo: *${esc(formatRp(newRefBalance))}*`;

                        bot.telegram.sendMessage(user.referred_by, refNotif, {
                            parse_mode: 'MarkdownV2'
                        }).catch(() => {});
                        
                        console.log(`✅ Komisi 10% (${bonusRef}) sukses dikirim ke ${user.referred_by}`);
                    } else {
                        console.error("❌ GAGAL UPDATE SALDO PENGUNDANG:", updateRefErr.message);
                    }
                }
            } else {
                console.log(`ℹ️ Top-up ke-${count || 0}. Komisi referral tidak dikirim untuk user ${deposit.user_id}.`);
            }
        }

        // =========================
        // 🗑️ HAPUS QR & KIRIM NOTIFIKASI
        // =========================
        if (deposit.message_id) {
            await bot.telegram.deleteMessage(deposit.user_id, deposit.message_id).catch(() => {});
        }

        const successMsg = `✅ *DEPOSIT BERHASIL\\!*\n\n💰 Nominal: ${esc(formatRp(amount))}\n${bonusPromo > 0 ? `🎁 Bonus Promo: ${esc(formatRp(bonusPromo))}\n` : ""}💵 Total Masuk: ${esc(formatRp(totalTambah))}\n\n💳 Saldo Sekarang: ${esc(formatRp(newBalance))}`;

        bot.telegram.sendMessage(deposit.user_id, successMsg, {
            parse_mode: 'MarkdownV2'
        }).catch(() => {});

        console.log("✅ Deposit sukses:", deposit.order_id);

        return res.send('OK');

    } catch (err) {
        console.error("❌ WEBHOOK ERROR:", err.message);
        return res.send('ERROR');
    }
});

const PORT = Number(process.env.BOT_PORT || process.env.PORT || 3000);
app.listen(PORT, () => console.log('✅ SERVER RUNNING'));

bot.catch((err, ctx) => {
    console.error("BOT ERROR:", err);
});

bot.launch({
    dropPendingUpdates: true
}).then(() => console.log('✅ BOT ONLINE'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

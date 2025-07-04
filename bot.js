const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let sock;

const destinatarios = ['56934967455@s.whatsapp.net'];

let tareasProgramadas = []; 

// Lee las frases desde el archivo JSON y devuelve una frase según hora
function obtenerFraseSegunHora() {
    const frases = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'frases.json'), 'utf-8'))[0];
    const hora = new Date().getHours();

    let tipo;
    if (hora > 4 && hora < 17) { // Entre 5 am y 4 pm se considera mañana
        tipo = 'mañana';
    } else if (hora >= 17 || hora <= 4) { // Entre 5 pm y 4 am se considera noche
        tipo = 'noche';
    } else {
        return null;
    }

    const lista = frases[tipo];
    return lista[Math.floor(Math.random() * lista.length)];
}

// Genera un horario cron para una hora fija con minuto aleatorio
function generarHorarioRandom(horaFija) {
    const minutoRandom = Math.floor(Math.random() * 60);
    return `${minutoRandom} ${horaFija} * * *`;
}

// Programa mensajes con minutos aleatorios para 9:XX y 23:XX
function programarMensajes(sock) {
    // Detener tareas anteriores si existen
    tareasProgramadas.forEach(tarea => tarea.stop());
    tareasProgramadas = [];

    const horarios = [
        generarHorarioRandom(9),  // 9:XX am
        generarHorarioRandom(23), // 23:XX pm
    ];

    horarios.forEach((cronTime) => {
        const tarea = cron.schedule(cronTime, async () => {
            if (!sock?.user?.id) {
                console.log('⚠️ No conectado. Se omite el envío.');
                return;
            }

            const frase = obtenerFraseSegunHora();
            if (!frase) {
                console.log('⏭️ No es una hora válida para enviar frases.');
                return;
            }

            for (const numero of destinatarios) {
                try {
                    await sock.sendMessage(numero, { text: frase });
                    console.log(`📤 Mensaje enviado a ${numero} (${cronTime}): ${frase}`);
                } catch (err) {
                    console.error(`❌ Error al enviar a ${numero}:`, err.message);
                }
            }
        });

        tareasProgramadas.push(tarea);
    });

    console.log('⏰ Mensajes programados en horarios:', horarios);
}

// Programa reprogramación diaria para actualizar minutos aleatorios a las 05:00 y 17:00
function programarReprogramacionDiaria(sock) {
    // A las 05:00 am
    cron.schedule('0 5 * * *', () => { // Reprograma la hora de cambio de los minutos aleatorios a las 05:00 am
        console.log('♻️ Reprogramando mensajes (05:00)');
        programarMensajes(sock);
    });

    // A las 17:00 pm
    cron.schedule('0 17 * * *', () => {
        console.log('♻️ Reprogramando mensajes (17:00)'); // Reprograma la hora de cambio de los minutos aleatorios a las 17:00 pm
        programarMensajes(sock);
    });
}

// Inicializa y arranca el bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve(__dirname, 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('🔑 Escanea este QR con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
            console.log('❌ Conexión cerrada. ¿Reconectar?:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp Web');
            programarMensajes(sock);
            programarReprogramacionDiaria(sock);
        } else if (connection) {
            console.log(`📡 Estado de conexión: ${connection}`);
        }
    });
}

startBot();
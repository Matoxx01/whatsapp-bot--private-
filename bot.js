const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let sock;

const destinatarios = ['56934967455@s.whatsapp.net'];

let tareasProgramadas = []; // Para controlar y cancelar tareas cron anteriores

// Lee las frases desde el archivo JSON y devuelve una frase según hora
function obtenerFraseSegunHora() {
    const frases = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'frases.json'), 'utf-8'))[0];
    const hora = new Date().getHours();

    let tipo;
    if (hora > 4 && hora < 17) {
        tipo = 'mañana';
    } else if (hora >= 17 || hora <= 4) {
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
        generarHorarioRandom(23), // 11:XX pm
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
    cron.schedule('0 5 * * *', () => {
        console.log('♻️ Reprogramando mensajes (05:00)');
        programarMensajes(sock);
    });

    // A las 17:00 pm
    cron.schedule('0 17 * * *', () => {
        console.log('♻️ Reprogramando mensajes (17:00)');
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
        // Desactivamos el QR automático de Baileys para manejarlo nosotros
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('🔑 Código QR generado para WhatsApp Web');
            console.log('====================================');
            
            // Método 1: QR Terminal básico (más compatible con Railway)
            try {
                qrcode.generate(qr, { 
                    small: true,
                    version: 1 
                });
                console.log('✅ QR mostrado arriba - Escanéalo con tu WhatsApp');
            } catch (error) {
                console.error('❌ Error generando QR visual:', error.message);
                
                // Método 2: Fallback - mostrar el código como texto
                console.log('📱 Código QR (texto plano):');
                console.log(qr);
                console.log('');
                console.log('💡 Copia este código y úsalo en una herramienta online de QR');
                console.log('   como: https://www.qr-code-generator.com/ o similar');
            }
            
            console.log('====================================');
            console.log('⏳ Esperando escaneo del código QR...');
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
            console.log('❌ Conexión cerrada. ¿Reconectar?:', shouldReconnect);
            
            if (shouldReconnect) {
                console.log('🔄 Reintentando conexión en 5 segundos...');
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('🛑 No se puede reconectar. Posible problema de autenticación.');
                console.log('   Elimina la carpeta "auth_info" y vuelve a intentar.');
            }
        } else if (connection === 'open') {
            console.log('✅ ¡Conectado exitosamente a WhatsApp Web!');
            console.log(`📱 Usuario: ${sock.user.name || 'Sin nombre'}`);
            console.log(`📞 Número: ${sock.user.id.split(':')[0]}`);
            console.log('');
            programarMensajes(sock);
            programarReprogramacionDiaria(sock);
        } else if (connection) {
            console.log(`📡 Estado de conexión: ${connection}`);
        }
    });

    // Manejo adicional de errores
    sock.ev.on('messages.upsert', ({ messages }) => {
        // Opcional: log de mensajes recibidos para debug
        messages.forEach(msg => {
            if (msg.key.fromMe) return; // Ignora mensajes propios
            console.log(`📥 Mensaje recibido de ${msg.key.remoteJid}: ${msg.message?.conversation || '[Mensaje multimedia]'}`);
        });
    });
}

// Iniciar el bot con manejo de errores
console.log('🚀 Iniciando WhatsApp Bot para Railway...');
console.log('⏰ Mensajes programados para 9:XX AM y 11:XX PM');
console.log('🔄 Reprogramación automática a las 05:00 y 17:00');
console.log('');

startBot().catch(error => {
    console.error('💥 Error fatal al iniciar el bot:', error);
    process.exit(1);
});
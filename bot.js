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
        printQRInTerminal: false,
        browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('🔑 ¡CÓDIGO QR GENERADO! Usa uno de estos métodos:');
            console.log('═══════════════════════════════════════════════════════');
            
            try {
                // Método 1: QR en terminal
                console.log('📱 OPCIÓN 1: Escanea el QR de abajo con WhatsApp');
                qrcode.generate(qr, { small: true });
                console.log('');
            } catch (error) {
                console.log('❌ No se pudo mostrar QR visual');
            }
            
            // Método 2: Código QR como texto
            console.log('📱 OPCIÓN 2: Copia este código y conviértelo a QR:');
            console.log(qr);
            console.log('');
            console.log('🌐 Páginas para generar QR:');
            console.log('   • https://www.qr-code-generator.com/');
            console.log('   • https://qr.io/');
            console.log('   • https://qrcode.tec-it.com/');
            console.log('');
            console.log('📖 INSTRUCCIONES:');
            console.log('   1. Copia el código de arriba');
            console.log('   2. Pégalo en una de las páginas web');
            console.log('   3. Genera el QR');
            console.log('   4. Escanéalo con WhatsApp');
            console.log('═══════════════════════════════════════════════════════');
            console.log('⏳ Esperando que escanees el código QR...');
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            
            console.log(`❌ Conexión cerrada. Código: ${statusCode}`);
            console.log(`🔄 ¿Reconectar?: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                console.log('🔄 Reintentando conexión en 10 segundos...');
                setTimeout(() => startBot(), 10000);
            } else {
                console.log('🛑 No se puede reconectar - Problema de autenticación');
                console.log('💡 SOLUCIÓN: Elimina la carpeta "auth_info" y vuelve a escanear QR');
                
                // Opcional: Eliminar auth_info automáticamente
                try {
                    const authPath = path.resolve(__dirname, 'auth_info');
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true });
                        console.log('🗑️ Carpeta auth_info eliminada automáticamente');
                        console.log('🔄 Reiniciando para generar nuevo QR...');
                        setTimeout(() => startBot(), 5000);
                    }
                } catch (err) {
                    console.error('❌ Error al eliminar auth_info:', err.message);
                }
            }
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO EXITOSAMENTE A WHATSAPP!');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`📱 Usuario: ${sock.user.name || 'Sin nombre'}`);
            console.log(`📞 Número: ${sock.user.id.split(':')[0]}`);
            console.log(`🌐 Plataforma: ${sock.user.platform || 'Desconocida'}`);
            console.log('═══════════════════════════════════════════════════════');
            console.log('🚀 Iniciando programación de mensajes...');
            
            programarMensajes(sock);
            programarReprogramacionDiaria(sock);
            
            console.log('✅ Bot completamente configurado y funcionando');
        } else {
            console.log(`📡 Estado de conexión: ${connection}`);
        }
    });

    // Manejo de errores de conexión
    sock.ev.on('connection.error', (error) => {
        console.error('💥 Error de conexión:', error);
    });

    // Log de mensajes recibidos (opcional, para debug)
    sock.ev.on('messages.upsert', ({ messages }) => {
        messages.forEach(msg => {
            if (msg.key.fromMe) return;
            const sender = msg.key.remoteJid;
            const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Multimedia]';
            console.log(`📥 Mensaje de ${sender}: ${content}`);
        });
    });
}

// Iniciar el bot con manejo de errores
console.log('🚀 INICIANDO WHATSAPP BOT PARA RAILWAY');
console.log('══════════════════════════════════════');
console.log('⏰ Mensajes programados: 9:XX AM y 11:XX PM');
console.log('🔄 Reprogramación automática: 05:00 y 17:00');
console.log('📱 Destinatarios:', destinatarios.map(n => n.replace('@s.whatsapp.net', '')));
console.log('══════════════════════════════════════');

startBot().catch(error => {
    console.error('💥 ERROR FATAL al iniciar el bot:', error);
    console.log('🔄 Reintentando en 30 segundos...');
    setTimeout(() => {
        startBot().catch(() => {
            console.error('💥 ERROR PERSISTENTE - Cerrando aplicación');
            process.exit(1);
        });
    }, 30000);
});
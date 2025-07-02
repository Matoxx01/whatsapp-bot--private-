const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const cron = require('node-cron');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');

let sock;
const app = express();
const PORT = process.env.PORT || 3000;

const destinatarios = ['56934967455@s.whatsapp.net'];
let tareasProgramadas = [];
let currentQR = null;

// Configurar Express
app.use(express.static('public'));
app.use(express.json());

// Endpoint para mostrar el QR
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Bot QR</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .qr-container { margin: 20px auto; max-width: 400px; }
                .status { padding: 20px; border-radius: 10px; margin: 20px; }
                .waiting { background: #fff3cd; color: #856404; }
                .connected { background: #d4edda; color: #155724; }
                .error { background: #f8d7da; color: #721c24; }
                button { padding: 10px 20px; font-size: 16px; margin: 10px; }
            </style>
            <script>
                function refreshPage() { location.reload(); }
                setInterval(refreshPage, 10000); // Auto-refresh cada 10 segundos
            </script>
        </head>
        <body>
            <h1>🤖 WhatsApp Bot - Railway</h1>
            <div id="status"></div>
            <div id="qr-container"></div>
            <button onclick="refreshPage()">🔄 Actualizar</button>
            <script>
                fetch('/status')
                    .then(r => r.json())
                    .then(data => {
                        const statusDiv = document.getElementById('status');
                        const qrDiv = document.getElementById('qr-container');
                        
                        if (data.connected) {
                            statusDiv.innerHTML = '<div class="status connected">✅ ¡Conectado a WhatsApp!</div>';
                            qrDiv.innerHTML = '<p>Bot funcionando correctamente</p>';
                        } else if (data.qr) {
                            statusDiv.innerHTML = '<div class="status waiting">⏳ Esperando escaneo del QR</div>';
                            qrDiv.innerHTML = '<img src="' + data.qr + '" alt="QR Code" style="max-width: 100%;">';
                        } else {
                            statusDiv.innerHTML = '<div class="status error">🔄 Conectando...</div>';
                            qrDiv.innerHTML = '<p>Generando código QR...</p>';
                        }
                    })
                    .catch(err => {
                        document.getElementById('status').innerHTML = '<div class="status error">❌ Error de conexión</div>';
                    });
            </script>
        </body>
        </html>
    `);
});

// API endpoint para obtener estado
app.get('/status', (req, res) => {
    res.json({
        connected: sock?.user?.id ? true : false,
        qr: currentQR,
        user: sock?.user?.name || null,
        number: sock?.user?.id ? sock.user.id.split(':')[0] : null
    });
});

// Iniciar servidor web
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado en puerto ${PORT}`);
    console.log(`🔗 Accede a tu QR en: https://tu-app.railway.app`);
});

// Resto de funciones del bot (iguales que antes)
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

function generarHorarioRandom(horaFija) {
    const minutoRandom = Math.floor(Math.random() * 60);
    return `${minutoRandom} ${horaFija} * * *`;
}

function programarMensajes(sock) {
    tareasProgramadas.forEach(tarea => tarea.stop());
    tareasProgramadas = [];

    const horarios = [
        generarHorarioRandom(9),
        generarHorarioRandom(23),
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

function programarReprogramacionDiaria(sock) {
    cron.schedule('0 5 * * *', () => {
        console.log('♻️ Reprogramando mensajes (05:00)');
        programarMensajes(sock);
    });

    cron.schedule('0 17 * * *', () => {
        console.log('♻️ Reprogramando mensajes (17:00)');
        programarMensajes(sock);
    });
}

// Función principal del bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve(__dirname, 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['WhatsApp Bot Railway', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('🔑 ¡CÓDIGO QR GENERADO!');
            
            // Generar QR como data URL para el servidor web
            try {
                currentQR = await qrcode.toDataURL(qr);
                console.log('✅ QR disponible en el servidor web');
                console.log(`🔗 Ve a tu URL de Railway para escanearlo`);
            } catch (error) {
                console.error('❌ Error generando QR:', error);
                currentQR = null;
            }
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            
            console.log(`❌ Conexión cerrada. Código: ${statusCode}`);
            currentQR = null; // Limpiar QR
            
            if (statusCode === 401) {
                try {
                    const authPath = path.resolve(__dirname, 'auth_info');
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true });
                        console.log('🗑️ Auth eliminado. Generando nuevo QR...');
                    }
                } catch (err) {
                    console.error('❌ Error al eliminar auth:', err.message);
                }
            }
            
            if (shouldReconnect) {
                const delay = statusCode === 500 ? 30000 : 15000;
                console.log(`🔄 Reintentando en ${delay/1000} segundos...`);
                setTimeout(() => startBot(), delay);
            }
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO EXITOSAMENTE A WHATSAPP!');
            console.log(`📱 Usuario: ${sock.user.name || 'Sin nombre'}`);
            console.log(`📞 Número: ${sock.user.id.split(':')[0]}`);
            
            currentQR = null; // Limpiar QR al conectar
            
            programarMensajes(sock);
            programarReprogramacionDiaria(sock);
            
            console.log('✅ Bot completamente configurado y funcionando');
        }
    });

    sock.ev.on('connection.error', (error) => {
        console.error('💥 Error de conexión:', error.message);
    });
}

console.log('🚀 INICIANDO WHATSAPP BOT CON SERVIDOR WEB');
console.log('══════════════════════════════════════════');
console.log(`🌐 Puerto: ${PORT}`);
console.log('📱 Destinatarios:', destinatarios.map(n => n.replace('@s.whatsapp.net', '')));
console.log('══════════════════════════════════════════');

startBot().catch(error => {
    console.error('💥 ERROR FATAL:', error);
    setTimeout(() => startBot(), 60000);
});
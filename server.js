const WebSocket = require('ws');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

const WS_PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`Servidor WebSocket iniciado en el puerto ${WS_PORT}`);

const canvasState = new Map();

const serviceAccount = {
    // Estas son las variables de entorno que debes configurar en Render,
    // extrayendo los valores de tu archivo JSON de Firebase.
    // Ejemplo de valores de tu archivo JSON:
    // "type": "service_account"
    "type": process.env.FIREBASE_TYPE,
    // "project_id": "paginamods-7c133"
    "project_id": process.env.FIREBASE_PROJECT_ID,
    // "private_key_id": "ff1e621cdf9daab3b6bab4541e31c0e6d65d5cac"
    "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
    // "private_key": "-----BEGIN PRIVATE KEY-----\n..."
    // NOTA: La private_key debe ir en una sola línea en la variable de entorno de Render,
    // y el código ya maneja la conversión de '\\n' a '\n'.
    "private_key": process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    // "client_email": "firebase-adminsdk-fbsvc@paginamods-7c133.iam.gserviceaccount.com"
    "client_email": process.env.FIREBASE_CLIENT_EMAIL,
    // "client_id": "113341584442842746427"
    "client_id": process.env.FIREBASE_CLIENT_ID,
    // "auth_uri": "https://accounts.google.com/o/oauth2/auth"
    "auth_uri": process.env.FIREBASE_AUTH_URI,
    // "token_uri": "https://oauth2.googleapis.com/token"
    "token_uri": process.env.FIREBASE_TOKEN_URI,
    // "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs"
    "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    // "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40paginamods-7c133.iam.gserviceaccount.com"
    "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL,
    // "universe_domain": "googleapis.com"
    "universe_domain": process.env.FIREBASE_UNIVERSE_DOMAIN
};

if (serviceAccount.private_key) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log("Firebase Admin SDK inicializado con credenciales de servicio.");
    } catch (error) {
        if (error.code === 'app/duplicate-app') {
            console.warn("Firebase Admin SDK ya inicializado.");
        } else {
            console.error("Error al inicializar Firebase Admin SDK:", error);
        }
    }
} else {
    console.warn("No se encontraron todas las credenciales de servicio de Firebase en las variables de entorno. Intentando inicializar sin ellas (puede funcionar en entornos de Google Cloud con cuenta de servicio adjunta).");
    try {
        admin.initializeApp();
        console.log("Firebase Admin SDK inicializado por defecto.");
    } catch (error) {
        if (error.code === 'app/duplicate-app') {
            console.warn("Firebase Admin SDK ya inicializado.");
        } else {
            console.error("Error al inicializar Firebase Admin SDK por defecto:", error);
        }
    }
}

const db = admin.firestore();

// Esta variable de entorno también se debe configurar en Render
// APP_ID: 'default-canvas-app' o cualquier otro ID único para tu app
const APP_ID = process.env.APP_ID || 'default-canvas-app';
const elementsCollectionRef = db.collection(`artifacts/${APP_ID}/public/data/canvasElements`);

// Estas son las variables de entorno que debes configurar en Render,
// extrayendo los valores de tu archivo de texto de Cloudinary.
// Cloud name: dw998s0ja
// API Key: 976289861226313
// API Secret: Mrc-p7Mxd2QNt_svkrQKI7uqGP4
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
console.log("Cloudinary configurado.");

async function sendInitialState(ws) {
    try {
        const snapshot = await elementsCollectionRef.get();
        const stateArray = [];
        snapshot.forEach(doc => {
            stateArray.push(doc.data());
        });

        canvasState.clear();
        stateArray.forEach(element => canvasState.set(element.id, element));

        ws.send(JSON.stringify({
            type: 'initialState',
            elements: stateArray
        }));
        console.log('Estado inicial enviado desde Firestore.');
    } catch (error) {
        console.error('Error al cargar el estado inicial desde Firestore:', error);
        ws.send(JSON.stringify({
            type: 'initialState',
            elements: Array.from(canvasState.values())
        }));
    }
}

function broadcastMessage(senderWs, message) {
    wss.clients.forEach(function each(client) {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

wss.on('connection', function connection(ws) {
    console.log('Cliente conectado');

    sendInitialState(ws);

    ws.on('message', async function incoming(message) {
        const parsedMessage = JSON.parse(message);

        switch (parsedMessage.type) {
            case 'elementAdd':
                if (parsedMessage.element.type === 'img' || parsedMessage.element.type === 'audio') {
                    try {
                        const uploadResult = await cloudinary.uploader.upload(parsedMessage.element.src, {
                            resource_type: parsedMessage.element.type === 'img' ? 'image' : 'video',
                            folder: `${APP_ID}/uploads`
                        });
                        
                        parsedMessage.element.src = uploadResult.secure_url;
                        parsedMessage.element.publicId = uploadResult.public_id;
                        console.log(`Archivo subido a Cloudinary: ${uploadResult.secure_url}`);
                    } catch (uploadError) {
                        console.error('Error al subir a Cloudinary:', uploadError);
                        return; 
                    }
                }
                
                canvasState.set(parsedMessage.element.id, parsedMessage.element);
                await elementsCollectionRef.doc(parsedMessage.element.id).set(parsedMessage.element);
                broadcastMessage(ws, parsedMessage);
                break;
            case 'elementUpdate':
                canvasState.set(parsedMessage.element.id, parsedMessage.element);
                await elementsCollectionRef.doc(parsedMessage.element.id).update(parsedMessage.element);
                broadcastMessage(ws, parsedMessage);
                break;
            case 'elementDelete':
                const elementToDelete = canvasState.get(parsedMessage.elementId);
                if (elementToDelete && (elementToDelete.type === 'img' || elementToDelete.type === 'audio') && elementToDelete.publicId) {
                    try {
                        await cloudinary.uploader.destroy(elementToDelete.publicId, {
                             resource_type: elementToDelete.type === 'img' ? 'image' : 'video'
                        });
                        console.log(`Archivo ${elementToDelete.publicId} eliminado de Cloudinary.`);
                    } catch (deleteError) {
                        console.error(`Error al eliminar ${elementToDelete.publicId} de Cloudinary:`, deleteError);
                    }
                }

                canvasState.delete(parsedMessage.elementId);
                await elementsCollectionRef.doc(parsedMessage.elementId).delete();
                broadcastMessage(ws, parsedMessage);
                break;
            case 'reorderLayers':
                for (const elementData of parsedMessage.elements) {
                    const existingElement = canvasState.get(elementData.id);
                    if (existingElement) {
                        existingElement.zIndex = elementData.zIndex;
                        await elementsCollectionRef.doc(elementData.id).update({ zIndex: elementData.zIndex });
                    }
                }
                broadcastMessage(ws, parsedMessage);
                break;
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
            case 'userConnect':
                broadcastMessage(ws, parsedMessage);
                break;
            case 'userDisconnect':
                broadcastMessage(ws, parsedMessage);
                break;
            case 'cursorMove':
                broadcastMessage(ws, parsedMessage);
                break;
            default:
                console.warn('Tipo de mensaje desconocido:', parsedMessage.type);
        }
    });

    ws.on('close', function close() {
        console.log('Cliente desconectado');
    });

    ws.on('error', function error(err) {
        console.error('Error de WebSocket:', err);
    });
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    });
}, 30000);

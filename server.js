// server.js
const WebSocket = require('ws');

// Puerto en el que el servidor WebSocket escuchará
const WS_PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`Servidor WebSocket iniciado en el puerto ${WS_PORT}`);

// Almacena el estado completo del lienzo, utilizando los IDs de los elementos como claves.
// Esta será la "fuente de verdad" para todos los clientes.
const canvasState = new Map();

// Función para enviar el estado actual del lienzo a un cliente específico
function sendInitialState(ws) {
    // Convertir el mapa a un array de objetos para enviarlo como JSON
    const stateArray = Array.from(canvasState.values());
    ws.send(JSON.stringify({
        type: 'initialState',
        elements: stateArray
    }));
}

// Función para difundir un mensaje a todos los clientes conectados, excepto al remitente original
function broadcastMessage(senderWs, message) {
    wss.clients.forEach(function each(client) {
        // Asegurarse de que el cliente esté abierto y no sea el remitente original (si aplica)
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

wss.on('connection', function connection(ws) {
    console.log('Cliente conectado');

    // Envía el estado actual del lienzo al cliente recién conectado
    sendInitialState(ws);

    ws.on('message', function incoming(message) {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error('Error al analizar el mensaje JSON:', error);
            return;
        }

        console.log('Mensaje recibido:', parsedMessage.type, 'de', parsedMessage.element ? parsedMessage.element.id : 'N/A');

        switch (parsedMessage.type) {
            case 'elementAdd':
            case 'elementUpdate':
                // Almacena o actualiza el elemento en el estado del servidor
                canvasState.set(parsedMessage.element.id, parsedMessage.element);
                // Difunde la actualización a otros clientes
                broadcastMessage(ws, parsedMessage);
                break;
            case 'elementDelete':
                // Elimina el elemento del estado del servidor
                canvasState.delete(parsedMessage.elementId);
                // Difunde la eliminación a otros clientes
                broadcastMessage(ws, parsedMessage);
                break;
            case 'reorderLayers':
                // Actualiza el z-index de los elementos basados en el nuevo orden
                // parsedMessage.elements es un array de objetos { id, zIndex }
                parsedMessage.elements.forEach(elementData => {
                    const existingElement = canvasState.get(elementData.id);
                    if (existingElement) {
                        existingElement.zIndex = elementData.zIndex;
                        canvasState.set(elementData.id, existingElement); // Update the map
                    }
                });
                // No necesitamos difundir 'reorderLayers' directamente,
                // ya que cada 'elementUpdate' por zIndex se manejará si se envía,
                // o el estado inicial ya contendrá el orden correcto.
                // Sin embargo, para una actualización inmediata de todos, podemos reenviar.
                // Para simplificar, difundo el evento reorderLayers completo para que los clientes
                // puedan re-renderizar sus listas de capas.
                broadcastMessage(ws, parsedMessage);
                break;
            case 'ping':
                // Responder a los pings para mantener la conexión viva
                ws.send(JSON.stringify({ type: 'pong' }));
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

// Implementación de ping/pong para mantener las conexiones vivas
// Esto ayuda a evitar desconexiones por inactividad
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    });
}, 30000); // Enviar ping cada 30 segundos

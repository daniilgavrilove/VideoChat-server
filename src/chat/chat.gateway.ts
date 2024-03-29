import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { validate, version } from 'uuid';
import ACTIONS from './actions';

@WebSocketGateway({
    path: '',
    cors: {
        origin: '*'
        // methods: ['GET', 'POST'],
    }
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
    private logger: Logger = new Logger('MessageGateway');

    handleConnection(client: Socket) {
        this.shareRoomsInfo();
        client.on(ACTIONS.JOIN, (config) => {
            const { room: roomId } = config;
            const { rooms: joinedRooms } = client;

            // Если подключены к комнате, то ворн
            if (Array.from(joinedRooms).includes(roomId)) {
                return console.warn(`Already connected to ${roomId}`);
            }

            // Получаем пользователей, подключённых к комнате
            const clients = this.server.sockets.adapter.rooms.get(roomId || []);
            console.log(this.server.sockets.adapter.rooms);
            clients?.forEach((clientID) => {
                // Кто есть в комнате - офер не создаёт
                this.server.to(clientID).emit(ACTIONS.ADD_PEER, {
                    peerId: client.id,
                    createOffer: false
                });

                // Кто подключается - создаёт офер
                client.emit(ACTIONS.ADD_PEER, {
                    peerId: clientID,
                    createOffer: true
                });
            });
            client.join(roomId);
            this.shareRoomsInfo();
        });
    }

    handleDisconnect(client: Socket) {
        this.leaveRoom(client);
    }

    @SubscribeMessage(ACTIONS.LEAVE)
    handleLeave(
        @MessageBody() data: string,
        @ConnectedSocket() client: Socket
    ) {
        // Handle received message
        this.leaveRoom(client);
    }

    @SubscribeMessage(ACTIONS.RELAY_SDP)
    handleRelaySDP(
        @MessageBody() { peerID, sessionDescription },
        @ConnectedSocket() client: Socket
    ) {
        // Handle received message
        this.server.to(peerID).emit(ACTIONS.SESSION_DESCRIPTION, {
            peerID: client.id,
            sessionDescription
        });
    }

    @SubscribeMessage(ACTIONS.RELAY_ICE)
    handleRelayICE(
        @MessageBody() { peerID, iceCandidate },
        @ConnectedSocket() client: Socket
    ) {
        // Handle received message
        this.server.to(peerID).emit(ACTIONS.ICE_CANDIDATE, {
            peerID: client.id,
            iceCandidate
        });
    }

    private leaveRoom(client) {
        const { rooms } = client;

        Array.from(rooms)
            .filter(
                (roomID: string) => validate(roomID) && version(roomID) === 4
            )
            .forEach((roomID: string) => {
                const clients = Array.from(
                    this.server.sockets.adapter.rooms.get(roomID) || []
                );
                clients.forEach((clientID) => {
                    this.server.to(clientID).emit(ACTIONS.REMOVE_PEER, {
                        peerID: client.id
                    });
                    client.emit(ACTIONS.REMOVE_PEER, {
                        peerID: clientID
                    });
                });
                client.leave(roomID);
            });
        this.shareRoomsInfo();
    }

    private getClientRooms() {
        const { rooms } = this.server.sockets.adapter;
        return Array.from(rooms.keys()).filter(
            (roomID) => validate(roomID) && version(roomID) === 4
        );
    }

    private shareRoomsInfo() {
        this.server.sockets.emit(ACTIONS.SHARE_ROOMS, {
            rooms: this.getClientRooms()
        });
    }
}

import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { Server as SocketIOServer, Socket } from 'socket.io';

export class BaseIO {
  protected log: Logger;
  protected io: SocketIOServer;

  constructor(socketname: string, { ioServer }: { ioServer: SocketIOServer }) {
    this.io = ioServer;
    this.initializeConnection();
    this.log = createLogger(socketname);
  }

  /**
   * Initialize socket connection and set up base event handlers
   */
  private initializeConnection(): void {
    this.io.on('connection', (socket: Socket) => {
      this.log.info(`Client connected: ${socket.id}`);

      this.setupBaseEventHandlers(socket);
    });
  }

  /**
   * Set up basic event handlers that are common to all socket connections
   */
  private setupBaseEventHandlers(socket: Socket): void {
    socket.on('disconnect', (reason: string) => {
      this.log.info(`Client disconnected: ${socket.id}, Reason: ${reason}`);
    });

    socket.on('error', (error: Error) => {
      this.log.error(`Socket error on client ${socket.id}:`, error);
    });

    socket.on('ping', () => {
      socket.emit('pong', { time: new Date().toISOString() });
    });
  }

  /**
   * Emit data to a room or to all connected clients
   */
  protected emitData(eventName: string, data: unknown, roomId?: string): void {
    try {
      if (roomId) {
        this.io.to(roomId).emit(eventName, data);
        this.log.debug(`Emitted '${eventName}' to room ${roomId}`);
      } else {
        this.io.emit(eventName, data);
        this.log.debug(`Broadcast '${eventName}' to all clients`);
      }
    } catch (error) {
      this.log.error(`Error emitting '${eventName}' event:`, error);
    }
  }

  /**
   * Emit data to a specific socket by ID
   */
  protected emitToSocket(socketId: string, eventName: string, data: unknown): boolean {
    try {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        this.log.warn(`Cannot emit to socket ${socketId}: Socket not found`);
        return false;
      }

      socket.emit(eventName, data);
      return true;
    } catch (error) {
      this.log.error(`Error emitting to socket ${socketId}:`, error);
      return false;
    }
  }

  /**
   * Join a socket to a room
   */
  protected joinRoom(socket: Socket, roomId: string): void {
    try {
      socket.join(roomId);
      this.log.info(`Socket ${socket.id} joined room: ${roomId}`);
    } catch (error) {
      this.log.error(`Error joining room ${roomId}:`, error);
    }
  }

  /**
   * Leave a room
   */
  protected leaveRoom(socket: Socket, roomId: string): void {
    try {
      socket.leave(roomId);
      this.log.info(`Socket ${socket.id} left room: ${roomId}`);
    } catch (error) {
      this.log.error(`Error leaving room ${roomId}:`, error);
    }
  }

  /**
   * Get all sockets in a room
   */
  protected async getSocketsInRoom(roomId: string): Promise<unknown[]> {
    try {
      const sockets = await this.io.in(roomId).fetchSockets();
      return sockets;
    } catch (error) {
      this.log.error(`Error fetching sockets in room ${roomId}:`, error);
      return [];
    }
  }

  /**
   * Count sockets in a room
   */
  protected async getRoomSize(roomId: string): Promise<number> {
    try {
      const sockets = await this.getSocketsInRoom(roomId);
      return sockets.length;
    } catch (error) {
      this.log.error(`Error counting sockets in room ${roomId}:`, error);
      return 0;
    }
  }

  /**
   * Disconnect all sockets
   */
  public disconnectAll(): void {
    try {
      this.io.disconnectSockets(true);
      this.log.info('All socket connections terminated');
    } catch (error) {
      this.log.error('Error disconnecting all sockets:', error);
    }
  }
}

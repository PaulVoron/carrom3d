/**
 * NetworkManager.js
 * Обёртка над PeerJS для обмена пакетами.
 */

import { Peer } from 'peerjs';

class NetworkManager {
  constructor() {
    this.peer = null;
    this.connection = null;
    this.callbacks = {};
    this.roomId = null;
    this.isHost = false;
  }

  /**
   * Подписка на сетевые события
   * @param {string} event 
   * @param {Function} callback 
   */
  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
  }

  /**
   * Отписка от событий
   */
  off(event, callback) {
    if (!this.callbacks[event]) return;
    this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
  }

  /**
   * Внутренний эмиттер событий
   */
  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => cb(data));
    }
  }

  /**
   * Отправить пакет данных
   * @param {string} type 
   * @param {object} payload 
   */
  send(type, payload = {}) {
    if (this.connection && this.connection.open) {
      this.connection.send({ type, ...payload });
    }
  }

  _generateId() {
    // 4 случайных символа (цифры и заглавные буквы)
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  /**
   * Создать комнату
   */
  async hostGame() {
    return new Promise((resolve, reject) => {
      this.disconnect(); // Очищаем прошлую сессию
      
      this.isHost = true;
      this.roomId = this._generateId();
      // Префикс для снижения вероятности коллизий на паблик-сервере
      const peerId = `carrom3d-${this.roomId}`;
      
      this.peer = new Peer(peerId, { debug: 2 });
      
      this.peer.on('open', () => {
        resolve(this.roomId);
      });

      this.peer.on('connection', (conn) => {
        if (this.connection) {
          conn.close(); // Разрешен только один оппонент
          return;
        }
        this.connection = conn;
        this._setupConnection();
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        reject(err);
      });
    });
  }

  /**
   * Присоединиться к комнате
   * @param {string} roomId 
   */
  async joinGame(roomId) {
    return new Promise((resolve, reject) => {
      this.disconnect();
      
      this.isHost = false;
      this.roomId = roomId.toUpperCase();
      const hostId = `carrom3d-${this.roomId}`;
      
      this.peer = new Peer({ debug: 2 });
      
      this.peer.on('open', () => {
        this.connection = this.peer.connect(hostId, { reliable: true });
        
        this.connection.on('open', () => {
          this._setupConnection();
          resolve();
        });
        
        this.connection.on('error', (err) => {
          reject(err);
        });
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Client Error:', err);
        reject(err);
      });
    });
  }

  _setupConnection() {
    this.connection.on('data', (data) => {
      if (data && data.type) {
        this.emit(data.type, data);
      }
    });

    this.connection.on('close', () => {
      this.emit('PLAYER_DISCONNECTED');
      this.connection = null;
    });
    
    this.emit('PLAYER_CONNECTED');
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.roomId = null;
    this.isHost = false;
  }
}

export const networkManager = new NetworkManager();

import React, { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { networkManager } from '../../engine/NetworkManager';
import styles from './MainMenu.module.scss';

export const MainMenu = () => {
  const networkMode = useGameStore((state) => state.networkMode);
  const connectionStatus = useGameStore((state) => state.connectionStatus);
  const roomCode = useGameStore((state) => state.roomCode);
  const setNetworkMode = useGameStore((state) => state.setNetworkMode);
  const setConnectionStatus = useGameStore((state) => state.setConnectionStatus);
  const setRoomCode = useGameStore((state) => state.setRoomCode);
  const setReady = useGameStore((state) => state.setReady);
  const initGame = useGameStore((state) => state.initGame);
  const setLocalPlayerRole = useGameStore((state) => state.setLocalPlayerRole);

  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  const startLocalGame = () => {
    setNetworkMode('local');
    setLocalPlayerRole(null);
    initGame();
    setReady(true);
  };

  const createOnlineGame = async () => {
    try {
      setNetworkMode('host');
      setConnectionStatus('waiting');
      const code = await networkManager.hostGame();
      setRoomCode(code);
      
      networkManager.on('PLAYER_CONNECTED', () => {
        setConnectionStatus('connected');
        initGame(1);
        setLocalPlayerRole(1); // Host is player 1
        setReady(true);
      });
      
      networkManager.on('PLAYER_DISCONNECTED', () => {
        setConnectionStatus('disconnected');
        alert('Суперник відключився.');
      });
    } catch (err) {
      setError('Помилка створення кімнати');
      setConnectionStatus('disconnected');
    }
  };

  const joinOnlineGame = async () => {
    if (!joinCode) return;
    try {
      setNetworkMode('client');
      setConnectionStatus('waiting');
      await networkManager.joinGame(joinCode);
      setRoomCode(joinCode);
      setConnectionStatus('connected');
      
      initGame(1);
      setLocalPlayerRole(2); // Client is player 2
      setReady(true);
      
      networkManager.on('PLAYER_DISCONNECTED', () => {
        setConnectionStatus('disconnected');
        alert('Хост відключився.');
      });
    } catch (err) {
      setError('Не вдалося підключитися. Перевірте код.');
      setConnectionStatus('disconnected');
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.menuCard}>
        <h1 className={styles.title}>Carrom 3D</h1>
        
        {connectionStatus === 'waiting' && networkMode === 'host' ? (
          <div className={styles.waitingState}>
            <h2>Очікування суперника</h2>
            <p>Код кімнати:</p>
            <div className={styles.roomCode}>{roomCode}</div>
            <button className={styles.cancelButton} onClick={() => {
              networkManager.disconnect();
              setConnectionStatus('disconnected');
            }}>Скасувати</button>
          </div>
        ) : connectionStatus === 'waiting' && networkMode === 'client' ? (
          <div className={styles.waitingState}>
            <h2>Підключення...</h2>
          </div>
        ) : (
          <div className={styles.actions}>
            <button className={styles.primaryButton} onClick={startLocalGame}>
              Локальна гра
            </button>
            <div className={styles.divider}>Або онлайн</div>
            <button className={styles.secondaryButton} onClick={createOnlineGame}>
              Створити гру
            </button>
            <div className={styles.joinContainer}>
              <input 
                type="text" 
                placeholder="Код" 
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                className={styles.input}
                maxLength={4}
              />
              <button className={styles.secondaryButton} onClick={joinOnlineGame}>
                Приєднатися
              </button>
            </div>
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

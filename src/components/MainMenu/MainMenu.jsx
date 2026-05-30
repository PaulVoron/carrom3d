import React, { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { networkManager } from '../../engine/NetworkManager';
import { useTranslation } from '../../i18n/translations';
import styles from './MainMenu.module.scss';

export const MainMenu = ({ onOpenSettings }) => {
  const networkMode = useGameStore((state) => state.networkMode);
  const connectionStatus = useGameStore((state) => state.connectionStatus);
  const roomCode = useGameStore((state) => state.roomCode);
  const setNetworkMode = useGameStore((state) => state.setNetworkMode);
  const setConnectionStatus = useGameStore((state) => state.setConnectionStatus);
  const setRoomCode = useGameStore((state) => state.setRoomCode);
  const setReady = useGameStore((state) => state.setReady);
  const initGame = useGameStore((state) => state.initGame);
  const setLocalPlayerRole = useGameStore((state) => state.setLocalPlayerRole);

  const { t } = useTranslation();

  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [showBotOptions, setShowBotOptions] = useState(false);

  const setGameMode = useGameStore((state) => state.setGameMode);

  const startLocalGame = () => {
    setGameMode('pvp');
    setNetworkMode('local');
    setLocalPlayerRole(null);
    initGame();
    setReady(true);
  };

  const startBotGame = (difficulty) => {
    setGameMode('pve', difficulty);
    setNetworkMode('local');
    setLocalPlayerRole(1); // Set local player role to 1 for camera lock
    initGame(); // initGame randomly assigns the starting player, bot has equal chance
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
        setLocalPlayerRole(1);
        setReady(true);
      });
      
      networkManager.on('PLAYER_DISCONNECTED', () => {
        setConnectionStatus('disconnected');
        alert(t('network.opponentDisconnected'));
      });
    } catch (err) {
      setError(t('network.createError'));
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
      setLocalPlayerRole(2);
      setReady(true);
      
      networkManager.on('PLAYER_DISCONNECTED', () => {
        setConnectionStatus('disconnected');
        alert(t('network.hostDisconnected'));
      });
    } catch (err) {
      setError(t('network.joinError'));
      setConnectionStatus('disconnected');
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.menuCard}>
        <h1 className={styles.title}>{t('menu.title')}</h1>
        
        {/* Кнопка настроек */}
        {onOpenSettings && (
          <button
            id="main-menu-settings-btn"
            className={styles.settingsBtn}
            onClick={onOpenSettings}
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            ⚙ {t('menu.settings')}
          </button>
        )}

        {connectionStatus === 'waiting' && networkMode === 'host' ? (
          <div className={styles.waitingState}>
            <h2>{t('menu.waiting')}</h2>
            <p>{t('menu.roomCode')}</p>
            <div className={styles.roomCode}>{roomCode}</div>
            <button className={styles.cancelButton} onClick={() => {
              networkManager.disconnect();
              setConnectionStatus('disconnected');
            }}>{t('menu.cancel')}</button>
          </div>
        ) : connectionStatus === 'waiting' && networkMode === 'client' ? (
          <div className={styles.waitingState}>
            <h2>{t('menu.connecting')}</h2>
          </div>
        ) : (
          <div className={styles.actions}>
            {showBotOptions ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: '0 0 10px 0', textAlign: 'center', color: '#fff' }}>{t('bot.difficulty')}</h3>
                <button className={styles.primaryButton} onClick={() => startBotGame(1)} disabled={true}>{t('bot.easy')}</button>
                <button className={styles.primaryButton} onClick={() => startBotGame(2)} disabled={true}>{t('bot.medium')}</button>
                <button className={styles.primaryButton} onClick={() => startBotGame(3)}>{t('bot.master')}</button>
                <button className={styles.secondaryButton} onClick={() => setShowBotOptions(false)}>{t('menu.cancel')}</button>
              </div>
            ) : (
              <>
                <button className={styles.primaryButton} onClick={startLocalGame}>
                  {t('menu.localGame')}
                </button>
                <button className={styles.primaryButton} onClick={() => setShowBotOptions(true)}>
                  {t('bot.playVsBot')}
                </button>
                <div className={styles.divider}>{t('menu.or')}</div>
                <button className={styles.secondaryButton} onClick={createOnlineGame}>
                  {t('menu.createGame')}
                </button>
                <div className={styles.joinContainer}>
                  <input 
                    type="text" 
                    placeholder={t('menu.roomCodePlaceholder')}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    className={styles.input}
                    maxLength={4}
                  />
                  <button className={styles.secondaryButton} onClick={joinOnlineGame}>
                    {t('menu.joinGame')}
                  </button>
                </div>
              </>
            )}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
      </div>
      <div className={styles.versionText}>Version 1.0.2
        <br />
        All rights reserved 2026 ©
      </div>
      <div className={styles.authorText}>
        Developed by Pavlo Voronin, 2026
        <br />
        <a href="mailto:voron.paul@gmail.com" className={styles.emailLink}>
          voron.paul@gmail.com
        </a>
      </div>
    </div>
  );
};


import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './GameOverPopup.module.scss';
import { orchestrator } from '../../game/GameOrchestrator';
import { networkManager } from '../../engine/NetworkManager';
import { useTranslation } from '../../i18n/translations';

export const GameOverPopup = () => {
  const winner = useGameStore((state) => state.winner);
  const gameOverScore = useGameStore((state) => state.gameOverScore);
  const networkMode = useGameStore((state) => state.networkMode);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);
  const isGameOverAnimating = useGameStore((state) => state.isGameOverAnimating);
  const { t } = useTranslation();
  
  const handleRestart = () => {
    const state = useGameStore.getState();
    if (state.networkMode === 'local') {
      orchestrator.restartGame();
    } else if (state.networkMode === 'host') {
      const nextStarter = state.lastStartingPlayer === 1 ? 2 : 1; 
      networkManager.send('RESTART_GAME', { startingPlayer: nextStarter });
      orchestrator.restartGame(nextStarter);
    } else if (state.networkMode === 'client') {
      networkManager.send('RESTART_REQUEST', {});
    }
  };

  // Не показываем попап пока идёт кинематическая анимация камеры
  if (!winner || isGameOverAnimating) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>
        <div className={styles.title}>{t('gameover.title')}</div>
        <div className={styles.winnerText}>
          {networkMode !== 'local' && localPlayerRole
            ? winner === localPlayerRole
              ? t('gameover.youWin')
              : t('gameover.youLose')
            : `${t('gameover.playerWins')} ${winner}`}
        </div>
        <div className={styles.scoreText}>{t('gameover.score')} {gameOverScore}</div>
        <button className={styles.newGameBtn} onClick={handleRestart}>
          {t('gameover.newGame')}
        </button>
      </div>
    </div>
  );
};

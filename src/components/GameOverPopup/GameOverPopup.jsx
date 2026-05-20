import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './GameOverPopup.module.scss';
import { orchestrator } from '../../game/GameOrchestrator';
import { networkManager } from '../../engine/NetworkManager';

export const GameOverPopup = () => {
  const winner = useGameStore((state) => state.winner);
  const gameOverScore = useGameStore((state) => state.gameOverScore);
  
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

  if (!winner) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>
        <div className={styles.title}>Гру закінчено!</div>
        <div className={styles.winnerText}>Переміг Гравець {winner}</div>
        <div className={styles.scoreText}>Рахунок: {gameOverScore}</div>
        <button className={styles.newGameBtn} onClick={handleRestart}>
          Нова гра
        </button>
      </div>
    </div>
  );
};

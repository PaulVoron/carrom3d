import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './ScoreBoard.module.scss';
import { QueenStatus } from '../QueenStatus/QueenStatus';

export const ScoreBoard = () => {
  const score = useGameStore((state) => state.score);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const playerColors = useGameStore((state) => state.playerColors);

  const getPlayerLabel = (pId) => {
    const color = playerColors[`player${pId}`];
    if (color === 'white') return 'Белые';
    if (color === 'black') return 'Черные';
    return 'Выбирает...';
  };

  const getPlayerScore = (pId) => {
    const color = playerColors[`player${pId}`];
    return color ? score[color] : 0;
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.playerPanel} ${styles.player1} ${currentPlayer === 1 ? styles.activeP1 : ''}`}>
        <div className={styles.playerName}>Игрок 1 ({getPlayerLabel(1)})</div>
        <div className={styles.playerScore}>{getPlayerScore(1)}</div>
      </div>

      <div className={styles.centerPanel}>
        <div className={`${styles.turnIndicator} ${currentPlayer === 1 ? styles.turnP1 : styles.turnP2}`}>
          ХОД: ИГРОК {currentPlayer}
        </div>
      </div>

      <div className={`${styles.playerPanel} ${styles.player2} ${currentPlayer === 2 ? styles.activeP2 : ''}`}>
        <div className={styles.playerName}>Игрок 2 ({getPlayerLabel(2)})</div>
        <div className={styles.playerScore}>{getPlayerScore(2)}</div>
      </div>

      <QueenStatus />
    </div>
  );
};

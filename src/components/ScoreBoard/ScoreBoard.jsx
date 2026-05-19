import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './ScoreBoard.module.scss';
import { QueenStatus } from '../QueenStatus/QueenStatus';

export const ScoreBoard = () => {
  const score = useGameStore((state) => state.score);
  const currentPlayer = useGameStore((state) => state.currentPlayer);

  return (
    <div className={styles.container}>
      <div className={`${styles.playerPanel} ${styles.player1} ${currentPlayer === 1 ? styles.activeP1 : ''}`}>
        <div className={styles.playerName}>Игрок 1 (Белые)</div>
        <div className={styles.playerScore}>{score.player1}</div>
      </div>

      <div className={styles.centerPanel}>
        <div className={`${styles.turnIndicator} ${currentPlayer === 1 ? styles.turnP1 : styles.turnP2}`}>
          ХОД: ИГРОК {currentPlayer}
        </div>
      </div>

      <div className={`${styles.playerPanel} ${styles.player2} ${currentPlayer === 2 ? styles.activeP2 : ''}`}>
        <div className={styles.playerName}>Игрок 2 (Черные)</div>
        <div className={styles.playerScore}>{score.player2}</div>
      </div>

      <QueenStatus />
    </div>
  );
};

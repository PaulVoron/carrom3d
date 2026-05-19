import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './GameOverPopup.module.scss';

export const GameOverPopup = () => {
  const winner = useGameStore((state) => state.winner);
  const gameOverScore = useGameStore((state) => state.gameOverScore);
  const initGame = useGameStore((state) => state.initGame);

  if (!winner) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>
        <div className={styles.title}>Игра окончена!</div>
        <div className={styles.winnerText}>Победил Игрок {winner}</div>
        <div className={styles.scoreText}>Счет: {gameOverScore}</div>
        <button className={styles.newGameBtn} onClick={initGame}>
          Новая игра
        </button>
      </div>
    </div>
  );
};
